"""Brand detection and removal from product images."""
from __future__ import annotations

import re
import unicodedata

TRADEMARK_MARKERS = ("®", "™", "℠")
CHINESE_BUSINESS_SUFFIXES = (
    "有限公司", "有限责任公司", "电子商务商行", "电子商务有限公司",
    "商贸商行", "百货商行", "玩具商行", "个体工商户", "工商户", "经营部",
    "工作室", "旗舰店", "专营店", "工厂", "厂家",
)

DEFAULT_BRAND_TERMS = frozenset({
    "3M", "ADIDAS", "APPLE", "BERSIH+", "BOSCH", "CESTBON", "COCA-COLA",
    "DELI", "DISNEY", "DYSON", "HAIER", "HELLO KITTY", "HUAWEI", "LEGO",
    "L'OREAL", "MARVEL", "MIDEA", "NIKE", "NESTLE", "OPPO", "PANASONIC",
    "PEPSI", "PHILIPS", "PUMA", "PRETTY", "PRETT", "PROTTY", "PIOTY",
    "PIETY", "SAMSUNG", "SONY", "STARBUCKS", "TEFAL", "UNILEVER", "VIVO",
    "XIAOMI", "洁又佳", "怡宝", "怡寳",
})

NON_BRAND_SINGLE_WORDS = frozenset({
    "BARU", "BAHAN", "BEG", "BERSIH", "BOLEH", "BUKA", "CAWAN", "CEPAT",
    "DAN", "DINDING", "EKSTRA", "GAM", "HARIAN", "HARUMAN", "HITAM",
    "JIMAT", "KALIS", "KEPING", "KERING", "KHAS", "KUALITI", "KUAT",
    "LUBANG", "MUDAH", "PANTAS", "PENGEDAP", "PHOTOCHROMIC", "PLASTIK",
    "PREMIUM", "PRODUK", "PUTIH", "RETAK", "RINGAN", "SAIZ", "SEALING",
    "SEBELUM", "SELEPAS", "SESUAI", "SPORTS", "STYLE", "TAHAN", "TEBAL",
    "TIDAK", "TUTUP", "UDARA", "UPGRADE", "VERSI", "WARNA",
})


def normalize_brand_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text).strip().casefold()
    return re.sub(r"[\s._\-—,:;，。·/\\|()（）\[\]【】]+", "", normalized)


class BrandPolicy:
    def __init__(self) -> None:
        self.terms = DEFAULT_BRAND_TERMS
        self._sorted_terms = tuple(sorted(self.terms, key=len, reverse=True))
        self._normalized_terms = {
            normalized
            for term in self.terms
            if (normalized := normalize_brand_text(term))
        }

    def is_brand_text(
        self, text: str, *, confidence: float,
        box: tuple[int, int, int, int], image_size: tuple[int, int],
    ) -> bool:
        stripped = text.strip()
        if not stripped:
            return False
        if any(marker in stripped for marker in TRADEMARK_MARKERS):
            return True
        normalized = normalize_brand_text(stripped)
        if normalized in self._normalized_terms:
            return True
        without_markers = stripped
        for marker in TRADEMARK_MARKERS:
            without_markers = without_markers.replace(marker, "")
        if normalize_brand_text(without_markers) in self._normalized_terms:
            return True
        compact = re.sub(r"[\s()（）\[\]【】,，。·]+", "", stripped)
        if (
            4 <= len(compact) <= 36
            and re.search(r"[\u3400-\u4dbf\u4e00-\u9fff]", compact)
            and compact.endswith(CHINESE_BUSINESS_SUFFIXES)
        ):
            return True
        width, height = image_size
        x1, y1, x2, y2 = box
        # Common AI-generator attribution marks are not product copy. Limit
        # the rule to compact corner marks so legitimate AI-related selling
        # points in the body of an image remain translatable.
        if (
            normalized.endswith(("ai生成", "ai创作"))
            and (x2 - x1) <= width * 0.40
            and (
                (y1 + y2) / 2 >= height * 0.72
                or (x1 + x2) / 2 >= width * 0.78
            )
        ):
            return True
        return self._looks_like_top_logo(
            stripped, confidence=confidence, box=box, image_size=image_size,
        )

    def remove_known_terms(self, text: str) -> str:
        cleaned = text
        for term in self._sorted_terms:
            if re.fullmatch(r"[A-Za-z0-9+&'. -]+", term):
                cleaned = re.sub(
                    rf"(?<![A-Za-z0-9]){re.escape(term)}(?![A-Za-z0-9])",
                    "", cleaned, flags=re.IGNORECASE,
                )
            else:
                cleaned = cleaned.replace(term, "")
        cleaned = re.sub(r"\s{2,}", " ", cleaned)
        return cleaned.strip(" \t\r\n,，、;；:：·|/-")

    @staticmethod
    def _looks_like_top_logo(
        text: str, *, confidence: float,
        box: tuple[int, int, int, int], image_size: tuple[int, int],
    ) -> bool:
        if confidence < 0.82:
            return False
        token = text.strip()
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9+&']{2,17}", token):
            return False
        if token.upper() in NON_BRAND_SINGLE_WORDS:
            return False
        if not re.search(r"[a-z][A-Z]", token):
            return False
        width, height = image_size
        x1, y1, x2, y2 = box
        center_y = (y1 + y2) / 2
        box_width = max(1, x2 - x1)
        return center_y <= height * 0.24 and box_width <= width * 0.60
