"""Configuration for the image translation service."""
from __future__ import annotations

import os
from pathlib import Path


def _env_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def _env_float(name: str, default: float, *, minimum: float, maximum: float) -> float:
    try:
        value = float(os.environ.get(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))

# Base directory of this service
SERVICE_DIR = Path(__file__).resolve().parent
MODELS_DIR = SERVICE_DIR / "models"
FONTS_DIR = SERVICE_DIR / "fonts"
TMP_DIR = SERVICE_DIR / "tmp"
LOGS_DIR = SERVICE_DIR / "logs"

# Ensure directories exist
TMP_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)

# Font paths (Linux DejaVu fonts as Arial replacement)
FONT_BOLD = FONTS_DIR / "DejaVuSans-Bold.ttf"
FONT_REG = FONTS_DIR / "DejaVuSans.ttf"

# Fall back to system fonts if local copies don't exist
_SYSTEM_FONT_DIR = Path("/usr/share/fonts/dejavu")
if not FONT_BOLD.is_file():
    FONT_BOLD = _SYSTEM_FONT_DIR / "DejaVuSans-Bold.ttf"
if not FONT_REG.is_file():
    FONT_REG = _SYSTEM_FONT_DIR / "DejaVuSans.ttf"

# Qwen / DashScope configuration
QWEN_API_KEY = os.environ.get("QWEN_API_KEY", "")
QWEN_MODEL = os.environ.get("QWEN_MODEL", "qwen3.7-max")
QWEN_API_URL = os.environ.get(
    "QWEN_API_URL",
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
)
QWEN_TIMEOUT_SECONDS = 30
QWEN_FAILURE_LIMIT = 3

# Google Translate (online fallback)
GOOGLE_TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single"
GOOGLE_TIMEOUT_SECONDS = 5
GOOGLE_FAILURE_LIMIT = 2

# OSS configuration
OSS_ACCESS_KEY_ID = os.environ.get("OSS_ACCESS_KEY_ID", "")
OSS_ACCESS_KEY_SECRET = os.environ.get("OSS_ACCESS_KEY_SECRET", "")
OSS_ENDPOINT = os.environ.get(
    "OSS_ENDPOINT",
    "https://oss-cn-shenzhen-internal.aliyuncs.com",
)
OSS_BUCKET_NAME = os.environ.get("OSS_BUCKET_NAME", "transfer-pic")
OSS_PREFIX = os.environ.get(
    "IMAGE_TRANSLATE_OSS_PREFIX",
    "image-translate",
).strip().strip("/") or "image-translate"

# Processing limits
MAX_IMAGES_PER_TASK = 50
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".jpe", ".jfif", ".png", ".webp", ".bmp", ".tif", ".tiff"}

# Durable worker queue. One worker is the safe default for the current
# 2-core/3.5GB host; the queue can be drained by additional processes after a
# measured capacity upgrade.
WORKER_COUNT = _env_int("IMAGE_TRANSLATE_WORKERS", 1, minimum=1, maximum=8)
MAX_QUEUED_IMAGES = _env_int(
    "IMAGE_TRANSLATE_MAX_QUEUED_IMAGES", 120, minimum=20, maximum=10000,
)
DEFAULT_ESTIMATED_IMAGE_SECONDS = _env_float(
    "IMAGE_TRANSLATE_ESTIMATED_IMAGE_SECONDS", 90.0, minimum=5.0, maximum=600.0,
)
MAX_ACTIVE_TASKS_PER_USER = _env_int(
    "IMAGE_TRANSLATE_MAX_ACTIVE_TASKS_PER_USER", 3, minimum=1, maximum=20,
)
MAX_JOB_ATTEMPTS = _env_int(
    "IMAGE_TRANSLATE_MAX_JOB_ATTEMPTS", 3, minimum=1, maximum=8,
)
QUEUE_POLL_SECONDS = _env_float(
    "IMAGE_TRANSLATE_QUEUE_POLL_SECONDS", 0.75, minimum=0.1, maximum=10.0,
)
RETRY_BASE_SECONDS = _env_float(
    "IMAGE_TRANSLATE_RETRY_BASE_SECONDS", 5.0, minimum=0.1, maximum=300.0,
)
SHUTDOWN_GRACE_SECONDS = _env_float(
    "IMAGE_TRANSLATE_SHUTDOWN_GRACE_SECONDS", 20.0, minimum=1.0, maximum=120.0,
)

# Image output settings
MAX_OUTPUT_EDGE = 1500  # Max longest edge, preserve aspect ratio
OUTPUT_WIDTH = _env_int("IMAGE_TRANSLATE_OUTPUT_WIDTH", 800, minimum=64, maximum=4096)
OUTPUT_HEIGHT = _env_int("IMAGE_TRANSLATE_OUTPUT_HEIGHT", 800, minimum=64, maximum=4096)
JPEG_QUALITY = 92

# Layout strategy for Chinese vertical copy translated to Latin text:
# - stacked: keep vertical columns, with upright Malay words stacked top-to-bottom
# - preserve: rotate each complete phrase inside its original vertical column
# - reflow: convert adjacent long phrases into horizontal poster blocks
VERTICAL_LAYOUT_MODE = os.environ.get(
    "IMAGE_TRANSLATE_VERTICAL_LAYOUT",
    "preserve",
).strip().lower()
