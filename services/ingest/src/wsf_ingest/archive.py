"""Compat shim: the archive moved to wsf-core when M4's analytics service
became its second consumer. Import from wsf_core.archive in new code."""

from wsf_core.archive import ArchiveBatch, archive_dim

__all__ = ["ArchiveBatch", "archive_dim"]
