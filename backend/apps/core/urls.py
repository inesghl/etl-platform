from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ETLViewSet,
    ExecutionViewSet,
    InputFileViewSet,
    NotificationViewSet,
    OutputFileViewSet,
)


router = DefaultRouter()
router.register(r"etls", ETLViewSet, basename="etl")
router.register(r"executions", ExecutionViewSet, basename="execution")
router.register(r"input-files", InputFileViewSet, basename="input-file")
router.register(r"output-files", OutputFileViewSet, basename="output-file")
router.register(r"notifications", NotificationViewSet, basename="notification")

urlpatterns = [
    path("", include(router.urls)),
]

