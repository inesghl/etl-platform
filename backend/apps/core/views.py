import os


from django.conf import settings
from django.http import FileResponse, Http404
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..accounts.permissions import IsAdmin, IsAdminOrReadOnly
from .models import ETL, Execution, InputFile, Notification, OutputFile
from .serializers import (
    AuditLogSerializer,
    ETLSerializer,
    ExecutionSerializer,
    InputFileSerializer,
    NotificationSerializer,
    OutputFileSerializer,
)


class ETLViewSet(viewsets.ModelViewSet):
    """
    Basic API for managing ETL definitions.


    For now this allows:
    - Admins: list, create (upload zip), update, delete
    - Authenticated users: read-only access to validated & active ETLs
    """


    queryset = ETL.objects.all().order_by("-created_at")
    serializer_class = ETLSerializer
    # Authentication + role-based permissions:
    # - Any authenticated user can read ETLs
    # - Only admins (role=admin or superuser) can create/update/delete
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]


    def get_queryset(self):
        user = self.request.user


        # Admins see everything
        if hasattr(user, "is_admin") and user.is_admin:
            return ETL.objects.all().order_by("-created_at")


        # Normal users see only validated & active ETLs
        return (
            ETL.objects.filter(is_active=True, is_validated=True).order_by(
                "-created_at"
            )
        )


    def perform_create(self, serializer):
        """
        Attach creator and do a very light validation on the uploaded file.
        Full validation pipeline will be implemented later.
        """
        zip_file = self.request.FILES.get("zip_file")


        if not zip_file:
            raise serializers.ValidationError(
                {"zip_file": ["This field is required."]}
            )


        # Simple safety check: only allow .zip files
        _, ext = os.path.splitext(zip_file.name)
        if ext.lower() != ".zip":
            raise serializers.ValidationError(
                {"zip_file": ["Only .zip files are allowed."]}
            )


        # Enforce max upload size from settings / env
        max_size = int(
            os.getenv("MAX_UPLOAD_SIZE", settings.FILE_UPLOAD_MAX_MEMORY_SIZE)
        )
        if zip_file.size > max_size:
            raise serializers.ValidationError(
                {
                    "zip_file": [
                        f"File too large (>{max_size} bytes). "
                        f"Current size: {zip_file.size} bytes."
                    ]
                }
            )
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsAdmin])
    def validate(self, request, pk=None):
        """
        Mark an ETL as validated.

        The full static validation pipeline (checking files inside the zip,
        parsing config.json, scanning requirements.txt, etc.) should be
        implemented in a dedicated service and invoked from here.
        For now, this simply flips the flag and clears previous errors.
        """
        etl: ETL = self.get_object()
        etl.is_validated = True
        etl.validation_errors = []
        etl.save(update_fields=["is_validated", "validation_errors"])
        return Response(ETLSerializer(etl).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsAdmin])
    def activate(self, request, pk=None):
        """
        Activate an ETL so that users can see and use it.
        """
        etl: ETL = self.get_object()
        if not etl.is_validated:
            return Response(
                {"detail": "ETL must be validated before activation."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        etl.is_active = True
        etl.save(update_fields=["is_active"])
        return Response(ETLSerializer(etl).data)


class ExecutionViewSet(viewsets.ModelViewSet):
    """
    API for creating and monitoring ETL executions.

    - Any authenticated user can create an execution for a validated & active ETL.
    - Admins can see every execution.
    - Normal users only see their own executions.
    """

    serializer_class = ExecutionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if hasattr(user, "is_admin") and user.is_admin:
            return Execution.objects.select_related("etl", "launched_by").all()
        return Execution.objects.select_related("etl", "launched_by").filter(
            launched_by=user
        )

    def perform_create(self, serializer):
        """
        Create a new execution in PENDING status and pre-compute
        the work_dir and initial runtime_config.
        """
        etl: ETL = serializer.validated_data["etl"]

        if not etl.is_active or not etl.is_validated:
            raise serializers.ValidationError(
                {"etl": ["ETL must be validated and active to launch executions."]}
            )

        # Workspace under MEDIA_ROOT/executions/<uuid>
        execution = serializer.save(
            launched_by=self.request.user,
            status="PENDING",
        )

        work_dir = settings.MEDIA_ROOT / "executions" / str(execution.id)
        execution.work_dir = str(work_dir)

        # Store a minimal runtime_config snapshot now; the engine can enrich it later.
        execution.runtime_config = {
            "etl_id": str(etl.id),
            "execution_id": str(execution.id),
            "entry_point": etl.entry_point,
            "expected_outputs": etl.expected_outputs,
            "input_requirements": etl.input_requirements,
        }
        execution.save(update_fields=["runtime_config"])

    @action(detail=True, methods=["post"])
    def launch(self, request, pk=None):
        """
        Trigger the execution.

        For now this only performs validation and simulates a quick successful run.
        The actual uv/venv logic will be plugged into this action later.
        """
        execution: Execution = self.get_object()
        etl = execution.etl

        # Basic guards
        if execution.status not in ("PENDING", "VALIDATED"):
            return Response(
                {"detail": f"Execution is already in status {execution.status}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate that required inputs exist
        missing_required = []
        requirements = etl.input_requirements
        existing_keys = set(
            execution.input_files.values_list("file_key", flat=True)
        )
        for key, spec in requirements.items():
            if spec.get("required", False) and key not in existing_keys:
                missing_required.append(key)

        if missing_required:
            execution.status = "VALIDATION_FAILED"
            execution.error_message = (
                f"Missing required inputs: {', '.join(missing_required)}"
            )
            execution.save(update_fields=["status", "error_message"])
            return Response(
                {
                    "detail": "Missing required inputs.",
                    "missing_inputs": missing_required,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Simulate execution lifecycle
        from django.utils import timezone

        execution.status = "RUNNING"
        execution.started_at = timezone.now()
        execution.stdout_log = "Execution started...\n(Engine not yet implemented)"
        execution.save(update_fields=["status", "started_at", "stdout_log"])

        # For now immediately mark as success. Later you will replace this with
        # a real background execution engine that uses uv/venv.
        execution.status = "SUCCESS"
        execution.completed_at = timezone.now()
        execution.return_code = 0
        execution.stdout_log += "\nExecution finished successfully (simulated)."
        execution.save(
            update_fields=["status", "completed_at", "return_code", "stdout_log"]
        )

        return Response(ExecutionSerializer(execution).data)


class InputFileViewSet(viewsets.ModelViewSet):
    """
    API for uploading and validating input files for an execution.
    """

    serializer_class = InputFileSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = InputFile.objects.select_related("execution", "uploaded_by")
        if hasattr(user, "is_admin") and user.is_admin:
            return qs.all()
        return qs.filter(uploaded_by=user)

    def perform_create(self, serializer):
        """
        Validate the file against the ETL's input_requirements and mark its status.
        """
        execution: Execution = serializer.validated_data["execution"]
        file_obj = self.request.FILES.get("uploaded_file")

        if not file_obj:
            raise serializers.ValidationError(
                {"uploaded_file": ["This field is required."]}
            )

        file_key: str = serializer.validated_data["file_key"]
        requirements = execution.etl.input_requirements
        spec = requirements.get(file_key)
        validation_errors: list[str] = []

        if not spec:
            validation_errors.append(
                f"No input_requirements entry found in config for key '{file_key}'."
            )

        # Basic extension check
        allowed_exts = (spec or {}).get("extensions") or []
        import os

        _, ext = os.path.splitext(file_obj.name)
        if allowed_exts and ext.lower() not in [e.lower() for e in allowed_exts]:
            validation_errors.append(
                f"Extension '{ext}' not allowed; expected one of {allowed_exts}."
            )

        status_value = "VALIDATED" if not validation_errors else "INVALID"

        instance: InputFile = serializer.save(
            original_filename=file_obj.name,
            uploaded_by=self.request.user,
            file_size=file_obj.size,
            status=status_value,
            validation_errors=validation_errors,
        )

        # If validation failed, also create a notification for the user.
        if validation_errors:
            Notification.objects.create(
                user=self.request.user,
                etl=execution.etl,
                execution=execution,
                level="error",
                title=f"Input validation failed ({file_key})",
                message="; ".join(validation_errors),
            )

        return instance


class OutputFileViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Read-only viewset for output files.
    """

    serializer_class = OutputFileSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = OutputFile.objects.select_related("execution")
        if hasattr(user, "is_admin") and user.is_admin:
            return qs.all()
        return qs.filter(execution__launched_by=user)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        """
        Download the physical output file.
        """
        output: OutputFile = self.get_object()
        try:
            response = FileResponse(open(output.file_path, "rb"))
        except FileNotFoundError:
            raise Http404("File not found on disk.")

        # Increment download counters
        from django.utils import timezone

        output.download_count += 1
        output.last_downloaded_at = timezone.now()
        output.save(update_fields=["download_count", "last_downloaded_at"])

        return response


class NotificationViewSet(viewsets.ModelViewSet):
    """
    User notifications (validation results, failures, completion, etc.).
    """

    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Notification.objects.filter(user=self.request.user)

