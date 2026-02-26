from rest_framework import serializers

from .models import (
    AuditLog,
    ETL,
    Execution,
    InputFile,
    Notification,
    OutputFile,
)


class ETLSerializer(serializers.ModelSerializer):
    class Meta:
        model = ETL
        fields = [
            "id",
            "name",
            "description",
            "version",
            "zip_file",
            "extracted_path",
            "config",
            "is_active",
            "is_validated",
            "validation_errors",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "extracted_path",
            "config",
            "is_active",
            "is_validated",
            "validation_errors",
            "created_by",
            "created_at",
            "updated_at",
        ]


class ExecutionSerializer(serializers.ModelSerializer):
    etl_name = serializers.CharField(source="etl.name", read_only=True)
    launched_by_username = serializers.CharField(
        source="launched_by.username",
        read_only=True,
    )

    class Meta:
        model = Execution
        fields = [
            "id",
            "etl",
            "etl_name",
            "execution_label",
            "launched_by",
            "launched_by_username",
            "status",
            "work_dir",
            "archive_path",
            "launched_at",
            "started_at",
            "completed_at",
            "return_code",
            "stdout_log",
            "stderr_log",
            "error_message",
            "runtime_config",
            "python_version_used",
            "venv_path",
            "dependencies_installed",
            "dependencies_log",
        ]
        read_only_fields = [
            "id",
            "etl_name",
            "launched_by_username",
            "status",
            "work_dir",
            "archive_path",
            "launched_at",
            "started_at",
            "completed_at",
            "return_code",
            "stdout_log",
            "stderr_log",
            "error_message",
            "runtime_config",
            "python_version_used",
            "venv_path",
            "dependencies_installed",
            "dependencies_log",
        ]


class InputFileSerializer(serializers.ModelSerializer):
    class Meta:
        model = InputFile
        fields = [
            "id",
            "execution",
            "file_key",
            "original_filename",
            "uploaded_file",
            "file_size",
            "status",
            "validation_errors",
            "uploaded_at",
            "uploaded_by",
        ]
        read_only_fields = [
            "id",
            "original_filename",
            "file_size",
            "status",
            "validation_errors",
            "uploaded_at",
            "uploaded_by",
        ]


class OutputFileSerializer(serializers.ModelSerializer):
    class Meta:
        model = OutputFile
        fields = [
            "id",
            "execution",
            "filename",
            "file_path",
            "file_size",
            "file_type",
            "created_at",
            "download_count",
            "last_downloaded_at",
        ]
        read_only_fields = [
            "id",
            "filename",
            "file_path",
            "file_size",
            "file_type",
            "created_at",
            "download_count",
            "last_downloaded_at",
        ]


class NotificationSerializer(serializers.ModelSerializer):
    etl_name = serializers.CharField(source="etl.name", read_only=True)
    execution_label = serializers.CharField(
        source="execution.execution_label",
        read_only=True,
    )

    class Meta:
        model = Notification
        fields = [
            "id",
            "user",
            "etl",
            "etl_name",
            "execution",
            "execution_label",
            "level",
            "title",
            "message",
            "is_read",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "user",
            "etl_name",
            "execution_label",
            "created_at",
        ]


class AuditLogSerializer(serializers.ModelSerializer):
    etl_name = serializers.CharField(source="etl.name", read_only=True)
    execution_label = serializers.CharField(
        source="execution.execution_label",
        read_only=True,
    )
    username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "action",
            "description",
            "user",
            "username",
            "etl",
            "etl_name",
            "execution",
            "execution_label",
            "metadata",
            "timestamp",
        ]
        read_only_fields = [
            "id",
            "username",
            "etl_name",
            "execution_label",
            "timestamp",
        ]