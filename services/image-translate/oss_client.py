"""Alibaba Cloud OSS client for image storage."""
from __future__ import annotations

import logging
from pathlib import Path

import oss2

from config import (
    OSS_ACCESS_KEY_ID,
    OSS_ACCESS_KEY_SECRET,
    OSS_ENDPOINT,
    OSS_BUCKET_NAME,
    OSS_PREFIX,
)

LOGGER = logging.getLogger("image_translate.oss")


class OSSClient:
    """Handles upload/download of images to/from Alibaba Cloud OSS."""

    def __init__(self) -> None:
        if not OSS_ACCESS_KEY_ID or not OSS_ACCESS_KEY_SECRET:
            self._bucket = None
            LOGGER.warning("OSS credentials not configured, storage disabled")
            return
        auth = oss2.Auth(OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET)
        self._bucket = oss2.Bucket(auth, OSS_ENDPOINT, OSS_BUCKET_NAME, is_cname=False)
        LOGGER.info("OSS client initialized: bucket=%s", OSS_BUCKET_NAME)

    @property
    def available(self) -> bool:
        return self._bucket is not None

    def ensure_lifecycle(self) -> bool:
        """Ensure OSS lifecycle rule exists for image-translate/ prefix (90-day expiry)."""
        if not self._bucket:
            return False
        try:
            from oss2.models import LifecycleRule, LifecycleExpiration, BucketLifecycle
            rule_id = "image-translate-expire-90d"
            try:
                existing = self._bucket.get_bucket_lifecycle()
                for r in existing.rules:
                    if r.id == rule_id and r.status == "Enabled":
                        return True  # Already exists
                rules = list(existing.rules)
            except oss2.exceptions.NoSuchLifecycle:
                rules = []
            rules.append(LifecycleRule(
                rule_id,
                "image-translate/",
                status=LifecycleRule.ENABLED,
                expiration=LifecycleExpiration(days=90),
            ))
            self._bucket.put_bucket_lifecycle(BucketLifecycle(rules))
            LOGGER.info("OSS lifecycle rule ensured: image-translate/ expires in 90 days")
            return True
        except Exception as e:
            LOGGER.warning("Failed to ensure OSS lifecycle: %s", e)
            return False

    def upload_file(self, local_path: Path, object_key: str) -> str:
        """Upload a local file to OSS. Returns the object key."""
        if not self._bucket:
            raise RuntimeError("OSS not configured")
        self._bucket.put_object_from_file(object_key, str(local_path))
        LOGGER.info("Uploaded to OSS: %s", object_key)
        return object_key

    def download_file(self, object_key: str, local_path: Path) -> Path:
        """Download a file from OSS to local path."""
        if not self._bucket:
            raise RuntimeError("OSS not configured")
        local_path.parent.mkdir(parents=True, exist_ok=True)
        self._bucket.get_object_to_file(object_key, str(local_path))
        return local_path

    def generate_signed_url(self, object_key: str, expires: int = 3600) -> str:
        """Generate a signed URL for temporary access (always HTTPS)."""
        if not self._bucket:
            raise RuntimeError("OSS not configured")
        url = self._bucket.sign_url("GET", object_key, expires)
        if url.startswith("http://"):
            url = "https://" + url[7:]
        return url

    def list_objects(self, prefix: str) -> list[str]:
        """List object keys under a prefix."""
        if not self._bucket:
            return []
        keys = []
        for obj in oss2.ObjectIterator(self._bucket, prefix=prefix):
            if not obj.key.endswith("/"):
                keys.append(obj.key)
        return keys

    @staticmethod
    def input_prefix(user_id: str, task_id: str) -> str:
        return f"{OSS_PREFIX}/{user_id}/{task_id}/input/"

    @staticmethod
    def output_prefix(user_id: str, task_id: str) -> str:
        return f"{OSS_PREFIX}/{user_id}/{task_id}/output/"
