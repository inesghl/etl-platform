from django.db import models
from django.conf import settings
import uuid




class ETL(models.Model):
    """
    ETL Definition uploaded by admin
    Contains the ETL package (zip), configuration, and validation status
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)


    # Basic information
    name = models.CharField(max_length=200, unique=True, help_text="Unique ETL name")
    description = models.TextField(blank=True, help_text="What does this ETL do?")
    version = models.CharField(max_length=50, default="1.0")


    # Files
    zip_file = models.FileField(
        upload_to='etls/',
        help_text="Uploaded ETL zip package"
    )
    extracted_path = models.CharField(
        max_length=500,
        blank=True,
        help_text="Path where zip was extracted"
    )


    # Configuration (parsed from config.json inside zip)
    config = models.JSONField(
        default=dict,
        blank=True,
        help_text="Parsed ETL configuration"
    )
    # Example expected structure (from config.json inside the ETL zip):
    # {
    #   "entry_point": "main.py",
    #   "python_version": "3.11",
    #   "input_requirements": {
    #       "facture_data": {...},
    #       "mapping": {...}
    #   },
    #   "expected_outputs": ["result.xlsx", "deleted.xlsx"]
    # }


    # Validation status
    is_active = models.BooleanField(
        default=False,
        help_text="Is this ETL available to users?"
    )
    is_validated = models.BooleanField(
        default=False,
        help_text="Has this ETL passed validation?"
    )
    validation_errors = models.JSONField(
        default=list,
        blank=True,
        help_text="List of validation errors if any"
    )


    # Metadata
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='created_etls'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


    class Meta:
        db_table = 'etls'
        ordering = ['-created_at']
        verbose_name = 'ETL'
        verbose_name_plural = 'ETLs'


    def __str__(self):
        return f"{self.name} v{self.version}"

    # Convenience helpers so the rest of the code does not have to
    # know the exact JSON structure every time.
    @property
    def entry_point(self) -> str:
        """
        Python file that should be executed as the ETL entry point.
        Defaults to 'main.py' if not present in config.
        """
        return self.config.get("entry_point", "main.py")

    @property
    def python_version(self) -> str | None:
        """
        Requested Python version for this ETL (e.g. '3.11').
        Used later to decide whether the current worker can run it.
        """
        return self.config.get("python_version")

    @property
    def input_requirements(self) -> dict:
        """
        Dict describing required / optional inputs.
        Keys are logical file names (e.g. 'facture_data').
        """
        return self.config.get("input_requirements", {}) or {}

    @property
    def expected_outputs(self) -> list[str]:
        """
        List of filenames that the ETL is expected to generate
        inside the outputs directory.
        """
        return self.config.get("expected_outputs", []) or []




class Execution(models.Model):
    """
    Single execution instance of an ETL
    Tracks the entire lifecycle from creation to completion
    """
    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('VALIDATING', 'Validating Inputs'),
        ('VALIDATED', 'Inputs Validated'),
        ('VALIDATION_FAILED', 'Validation Failed'),
        ('INSTALLING_DEPS', 'Installing Dependencies'),
        ('RUNNING', 'Running'),
        ('SUCCESS', 'Success'),
        ('FAILED', 'Failed'),
        ('CANCELLED', 'Cancelled'),
    ]


    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)


    # ETL reference
    etl = models.ForeignKey(
        ETL,
        on_delete=models.CASCADE,
        related_name='executions'
    )


    # Execution metadata
    execution_label = models.CharField(
        max_length=200,
        blank=True,
        help_text="Optional label (e.g., 'January 2024')"
    )
    launched_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='launched_executions'
    )


    # Status tracking
    status = models.CharField(
        max_length=50,
        choices=STATUS_CHOICES,
        default='PENDING'
    )


    # File paths
    work_dir = models.CharField(
        max_length=500,
        help_text="Execution workspace directory"
    )
    archive_path = models.CharField(
        max_length=500,
        blank=True,
        help_text="Path to archived execution"
    )


    # Timing
    launched_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)


    # Execution results
    return_code = models.IntegerField(
        null=True,
        blank=True,
        help_text="Exit code: 0=success, non-zero=failure"
    )
    stdout_log = models.TextField(blank=True, help_text="Standard output")
    stderr_log = models.TextField(blank=True, help_text="Error output")
    error_message = models.TextField(blank=True)

    # Runtime / environment details (filled by the execution engine)
    runtime_config = models.JSONField(
        default=dict,
        blank=True,
        help_text=(
            "Snapshot of the runtime configuration passed to the ETL "
            "process (paths to inputs, outputs directory, etc.)."
        ),
    )
    python_version_used = models.CharField(
        max_length=20,
        blank=True,
        help_text="Python version that actually ran this execution (e.g. '3.11.8').",
    )
    venv_path = models.CharField(
        max_length=500,
        blank=True,
        help_text="Filesystem path to the uv/virtual environment used for this run.",
    )
    dependencies_installed = models.BooleanField(
        default=False,
        help_text="True when requirements.txt was installed successfully in the venv.",
    )
    dependencies_log = models.TextField(
        blank=True,
        help_text="Raw log output from the dependency installation step (uv / pip).",
    )


    class Meta:
        db_table = 'executions'
        ordering = ['-launched_at']
        verbose_name = 'Execution'
        verbose_name_plural = 'Executions'


    def __str__(self):
        return f"{self.etl.name} - {self.launched_at:%Y-%m-%d %H:%M}"


    @property
    def duration_seconds(self):
        """Calculate execution duration"""
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None




class InputFile(models.Model):
    """
    Input file uploaded by user for an execution
    """
    STATUS_CHOICES = [
        ('UPLOADED', 'Uploaded'),
        ('VALIDATED', 'Validated'),
        ('INVALID', 'Invalid'),
    ]


    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)


    # Belongs to execution
    execution = models.ForeignKey(
        Execution,
        on_delete=models.CASCADE,
        related_name='input_files'
    )


    # File information
    file_key = models.CharField(
        max_length=100,
        help_text="Key from ETL config (e.g., 'facture_data')"
    )
    original_filename = models.CharField(
        max_length=500,
        help_text="User's original filename"
    )
    uploaded_file = models.FileField(upload_to='inputs/')
    file_size = models.BigIntegerField(help_text="Size in bytes")


    # Validation
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='UPLOADED'
    )
    validation_errors = models.JSONField(default=list, blank=True)


    # Metadata
    uploaded_at = models.DateTimeField(auto_now_add=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True
    )


    class Meta:
        db_table = 'input_files'
        ordering = ['uploaded_at']
        unique_together = ['execution', 'file_key']


    def __str__(self):
        return f"{self.file_key}: {self.original_filename}"




class OutputFile(models.Model):
    """
    Output file produced by ETL execution
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)


    # Belongs to execution
    execution = models.ForeignKey(
        Execution,
        on_delete=models.CASCADE,
        related_name='output_files'
    )


    # File information
    filename = models.CharField(max_length=500)
    file_path = models.CharField(max_length=1000, help_text="Absolute path to file")
    file_size = models.BigIntegerField(help_text="Size in bytes")
    file_type = models.CharField(
        max_length=50,
        help_text="File type (excel, csv, pdf, etc.)"
    )


    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)


    # Download tracking
    download_count = models.IntegerField(default=0)
    last_downloaded_at = models.DateTimeField(null=True, blank=True)


    class Meta:
        db_table = 'output_files'
        ordering = ['created_at']


    def __str__(self):
        return self.filename




class AuditLog(models.Model):
    """
    Complete audit trail of all actions in the platform
    """
    ACTION_CHOICES = [
        ('ETL_UPLOADED', 'ETL Uploaded'),
        ('ETL_VALIDATED', 'ETL Validated'),
        ('ETL_ACTIVATED', 'ETL Activated'),
        ('ETL_DEACTIVATED', 'ETL Deactivated'),
        ('EXECUTION_CREATED', 'Execution Created'),
        ('INPUT_UPLOADED', 'Input File Uploaded'),
        ('EXECUTION_STARTED', 'Execution Started'),
        ('EXECUTION_COMPLETED', 'Execution Completed'),
        ('EXECUTION_FAILED', 'Execution Failed'),
        ('OUTPUT_DOWNLOADED', 'Output File Downloaded'),
        ('EXECUTION_ARCHIVED', 'Execution Archived'),
    ]


    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)


    # What happened
    action = models.CharField(max_length=50, choices=ACTION_CHOICES)
    description = models.TextField()


    # Who did it
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True
    )


    # When
    timestamp = models.DateTimeField(auto_now_add=True)


    # Context
    etl = models.ForeignKey(ETL, on_delete=models.SET_NULL, null=True, blank=True)
    execution = models.ForeignKey(Execution, on_delete=models.SET_NULL, null=True, blank=True)


    # Additional data
    metadata = models.JSONField(default=dict, blank=True)


    class Meta:
        db_table = 'audit_logs'
        ordering = ['-timestamp']


    def __str__(self):
        return f"{self.action} - {self.timestamp:%Y-%m-%d %H:%M}"




class Notification(models.Model):
    """
    Simple user notification model.

    Used to inform users/admins about validation results, dependency
    installation failures, execution completion, etc.
    """

    LEVEL_CHOICES = [
        ("info", "Info"),
        ("warning", "Warning"),
        ("error", "Error"),
        ("success", "Success"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Who should see this notification
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
    )

    # Optional context
    etl = models.ForeignKey(
        ETL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="notifications",
    )
    execution = models.ForeignKey(
        Execution,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="notifications",
    )

    # Payload
    level = models.CharField(max_length=20, choices=LEVEL_CHOICES, default="info")
    title = models.CharField(max_length=200)
    message = models.TextField()
    is_read = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "notifications"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"[{self.level}] {self.title}"



