"""Configuration for the image translation service."""
from __future__ import annotations

import os
from pathlib import Path

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
OSS_ENDPOINT = os.environ.get("OSS_ENDPOINT", "https://oss-cn-shenzhen.aliyuncs.com")
OSS_BUCKET_NAME = os.environ.get("OSS_BUCKET_NAME", "transfer-pic")
OSS_PREFIX = "image-translate"

# Processing limits
MAX_IMAGES_PER_TASK = 50
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".jpe", ".jfif", ".png", ".webp", ".bmp", ".tif", ".tiff"}

# Image output settings
MAX_OUTPUT_EDGE = 1500  # Max longest edge, preserve aspect ratio
OUTPUT_WIDTH = 800
OUTPUT_HEIGHT = 800
JPEG_QUALITY = 92

# Layout strategy for Chinese vertical copy translated to Latin text:
# - stacked: keep vertical columns, with upright Malay words stacked top-to-bottom
# - preserve: rotate each complete phrase inside its original vertical column
# - reflow: convert adjacent long phrases into horizontal poster blocks
VERTICAL_LAYOUT_MODE = os.environ.get(
    "IMAGE_TRANSLATE_VERTICAL_LAYOUT",
    "preserve",
).strip().lower()
