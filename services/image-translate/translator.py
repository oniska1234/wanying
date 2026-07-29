"""Malay translator with Qwen LLM (primary) + Google + offline fallback."""
from __future__ import annotations

import gc
import json
import logging
import re
import urllib.parse
import urllib.request
from pathlib import Path

from config import (
    QWEN_API_KEY,
    QWEN_MODEL,
    QWEN_API_URL,
    QWEN_TIMEOUT_SECONDS,
    QWEN_FAILURE_LIMIT,
    GOOGLE_TRANSLATE_URL,
    GOOGLE_TIMEOUT_SECONDS,
    GOOGLE_FAILURE_LIMIT,
    MODELS_DIR,
)

LOGGER = logging.getLogger("image_translate.translation")

MAX_POSTER_WORDS = 28
MAX_POSTER_CHARACTERS = 160


def _normalize_source_phrase(text: str) -> str:
    return re.sub(r"[\s,，、。.!！?？:：;；·()（）\[\]【】_—-]", "", text)


ECOMMERCE_PHRASES = {
    "产品信息": "MAKLUMAT PRODUK",
    "产品参数": "SPESIFIKASI PRODUK",
    "产品特点": "CIRI-CIRI PRODUK",
    "使用方法": "CARA PENGGUNAAN",
    "使用说明": "PANDUAN PENGGUNAAN",
    "注意事项": "PERHATIAN",
    "温馨提示": "PERINGATAN",
    "适用范围": "SESUAI UNTUK",
    "升级版": "VERSI DIPERTINGKAT",
    "加厚升级": "LEBIH TEBAL & TAHAN LAMA",
    "强力粘合": "LEKATAN KUAT",
    "防水防漏": "KALIS AIR & TIDAK MUDAH BOCOR",
    "防水防风": "KALIS AIR & ANGIN",
    "耐用": "TAHAN LAMA",
    "无异味": "TANPA BAU",
    "易清洗": "MUDAH DICUCI",
    "易安装": "MUDAH DIPASANG",
    "使用方便": "MUDAH DIGUNAKAN",
    "多种用途": "PELBAGAI KEGUNAAN",
    "一擦即净": "BERSIH DENGAN SEKALI LAP",
    "省时省力": "JIMAT MASA & TENAGA",
    "轻巧便携": "RINGAN & MUDAH DIBAWA",
    "小巧便携": "KOMPAK & MUDAH DIBAWA",
    "可重复使用": "BOLEH DIGUNAKAN SEMULA",
    "安全无毒": "SELAMAT & TIDAK BERTOKSIK",
    "天然环保": "SEMULA JADI & MESRA ALAM",
    "强力吸盘": "CAWAN SEDUT KUAT",
    "可拆卸移位": "BOLEH DITANGGAL & DIALIHKAN",
    "快速上墙，无需久等": "TERUS LEKAT PADA DINDING, TAK PERLU MENUNGGU",
    "向右旋转拧紧吸附": "PUTAR KE KANAN UNTUK KUNCI SEDUTAN",
    "向左旋转解锁移动": "PUTAR KE KIRI UNTUK BUKA & ALIHKAN",
    "与众不同": "REKA BENTUK UNIK",
    "蛋黄鸭家族化设计": "REKA BENTUK ITIK KUNING COMEL",
    "快速起泡": "CEPAT BERBUIH",
    "决速起泡": "CEPAT BERBUIH",
    "快速且丰富起泡 大刷面温和接触": (
        "BUIH MELIMPAH DENGAN CEPAT · PERMUKAAN BERUS BESAR & LEMBUT PADA KULIT"
    ),
    "颜色": "WARNA",
    "材质": "BAHAN",
    "尺寸": "SAIZ",
    "重量": "BERAT",
}
NORMALIZED_ECOMMERCE_PHRASES = {
    _normalize_source_phrase(s): t for s, t in ECOMMERCE_PHRASES.items()
}

MALAYSIA_TERM_REPLACEMENTS = (
    ("gratis ongkir", "penghantaran percuma"),
    ("ongkos kirim", "kos penghantaran"),
    ("pesan sekarang", "beli sekarang"),
    ("masukkan ke keranjang", "masukkan ke troli"),
    ("pendingin udara", "penyaman udara"),
    ("air conditioner", "penyaman udara"),
    ("desain praktis", "reka bentuk mesra pengguna"),
    ("kualitas bagus", "kualiti tinggi"),
    ("mudah untuk digunakan", "mudah digunakan"),
    ("mudah untuk dibersihkan", "mudah dibersihkan"),
    ("anti air", "kalis air"),
    ("tahan air", "kalis air"),
    ("anti angin", "kalis angin"),
    ("anti bocor", "tidak mudah bocor"),
    ("kualitas", "kualiti"),
    ("desain", "reka bentuk"),
    ("ukuran", "saiz"),
    ("kamar", "bilik"),
    ("cocok untuk", "sesuai untuk"),
    ("bisa", "boleh"),
    ("lem", "gam"),
    ("segel", "pengedap"),
    ("kokoh", "kukuh"),
    ("awet", "tahan lama"),
    ("praktis", "mudah digunakan"),
    ("nyaman", "selesa"),
    ("gratis", "percuma"),
    ("diskon", "diskaun"),
    ("keranjang", "troli"),
    ("kantong", "beg"),
    ("handuk", "tuala"),
    ("sikat", "berus"),
    ("spons", "span"),
    ("wastafel", "singki"),
    ("kulkas", "peti sejuk"),
    ("stiker", "pelekat"),
    ("resleting", "zip"),
    ("mencuci", "membasuh"),
    ("cuci", "basuh"),
    ("silahkan", "sila"),
)

INDONESIAN_WORDING_RE = re.compile(
    r"\b(?:kualitas|desain|ukuran|kamar|cocok|bisa|lem|segel|kokoh|awet|"
    r"praktis|nyaman|gratis|ongkir|diskon|keranjang|kantong|handuk|"
    r"sikat|spons|wastafel|kulkas|stiker|resleting|mencuci|silahkan|"
    r"banget|nggak|gak|udah|yuk|cuma|biar|buat|pakai)\b",
    flags=re.IGNORECASE,
)

MACHINE_TRANSLATION_RE = re.compile(
    r"\b(?:pengalihan migrasi|penghisap mahal|cepat dan cepat|pintu buka|"
    r"glukosa penyembunyian|akan memberitahu anda|maafkan aku)\b",
    flags=re.IGNORECASE,
)


def _match_case(replacement: str, matched: str) -> str:
    if matched.isupper():
        return replacement.upper()
    if matched[:1].isupper():
        return replacement[:1].upper() + replacement[1:]
    return replacement


def clean_translation(text: str) -> str:
    text = text.translate(str.maketrans({
        "【": "[", "】": "]", "（": "(", "）": ")",
        "①": "1.", "②": "2.", "③": "3.", "④": "4.", "⑤": "5.",
        "：": ":", "；": ";", "，": ",", "。": ".",
    }))
    text = text.replace("\u2581", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def polish_malaysia_ecommerce(text: str, *, source_text: str | None = None) -> str:
    text = clean_translation(text)
    for literal, natural in MALAYSIA_TERM_REPLACEMENTS:
        text = re.sub(
            rf"\b{re.escape(literal)}\b",
            lambda m: _match_case(natural, m.group(0)),
            text,
            flags=re.IGNORECASE,
        )
    text = re.sub(r"^(?:Produk ini|Ia adalah|Ini adalah|Ini merupakan)\s+", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:dengan sangat mudah|secara sangat mudah)\b", "dengan mudah", text, flags=re.IGNORECASE)
    text = re.sub(r"\b([A-Za-zÀ-ÿ]+)(?:\s+\1\b)+", r"\1", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*([,:])\s*", r"\1 ", text)
    text = re.sub(r"\s*;\s*", " · ", text)
    text = re.sub(r"\s*&\s*", " & ", text)
    text = re.sub(r"\s*·\s*", " · ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if source_text and not re.search(r"[。！？!?]$", source_text.strip()) and len(text) <= 80:
        text = text.rstrip(".")
    return text


def malay_quality_issues(text: str, *, source_text: str | None = None) -> tuple[str, ...]:
    issues: list[str] = []
    if not text:
        return ("empty",)
    if re.search(r"[\u3400-\u4dbf\u4e00-\u9fff]", text):
        issues.append("contains_chinese")
    if "\ufffd" in text or "<unk>" in text.lower() or "[unk]" in text.lower():
        issues.append("invalid_character")
    if re.search(r"[♪♫♬]", text):
        issues.append("invalid_symbol")
    if INDONESIAN_WORDING_RE.search(text):
        issues.append("non_malaysian_wording")
    if re.search(r"\b([A-Za-zÀ-ÿ]{2,})(?:\s+\1\b)+", text, flags=re.IGNORECASE):
        issues.append("repeated_word")
    if MACHINE_TRANSLATION_RE.search(text):
        issues.append("conversational_machine_translation")
    if re.search(r"^(?:terjemahan|translation|maksud|nota|catatan)\s*:", text, flags=re.IGNORECASE):
        issues.append("contains_explanation")
    if source_text and text.casefold() == source_text.casefold():
        issues.append("unchanged_source")
    words = re.findall(r"[A-Za-zÀ-ÿ0-9]+", text)
    if len(words) > MAX_POSTER_WORDS:
        issues.append("too_many_words")
    if len(re.findall(r"[,;:·.!?]", text)) > 4:
        issues.append("too_many_clauses")
    if len(text) > MAX_POSTER_CHARACTERS:
        issues.append("too_long_for_image")
    return tuple(issues)


QWEN_SYSTEM_PROMPT = """\
Anda ialah penterjemah profesional untuk platform e-dagang Malaysia (Shopee MY, TikTok Shop MY, Lazada MY).

TUGAS: Terjemahkan teks Cina kepada Bahasa Melayu (Bahasa Malaysia) yang semula jadi dan tempatan.

PERATURAN PENTING:
1. Gunakan Bahasa Melayu standard Malaysia (BUKAN Bahasa Indonesia).
2. Gaya bahasa: Ringkas, padat, sesuai untuk paparan pada gambar produk.
3. Nada: Profesional tetapi mesra, seperti peniaga tempatan Malaysia.
4. JANGAN tambah penjelasan atau perkataan yang tiada dalam teks asal.
5. JANGAN guna ayat penuh jika teks asal hanya frasa/label.
6. Jika teks mengandungi angka, unit, atau saiz, kekalkan format asal.
7. Output HANYA teks terjemahan sahaja, tanpa sebarang penjelasan tambahan.
8. Untuk nama produk dan tajuk, gunakan struktur frasa nama BM yang semula jadi (cth: "Telur Itik Masin Teluk Beibu" bukan "Teluk Beibu Telur Itik Masin").
9. Untuk slogan/frasa pendek, gunakan ungkapan idiomatik BM yang setara jika ada.
10. Untuk penerangan rasa/kualiti, guna perkataan yang biasa dilihat pada pembungkusan produk Malaysia.
11. Nama tempat geografi: kekalkan sebutan asal dalam Rumi (cth: 北部湾 → Teluk Beibu).
"""

QWEN_BATCH_SYSTEM_PROMPT = """\
Anda ialah penterjemah profesional untuk platform e-dagang Malaysia (Shopee MY, TikTok Shop MY, Lazada MY).

TUGAS: Terjemahkan SENARAI teks Cina kepada Bahasa Melayu (Bahasa Malaysia) yang semula jadi.

PERATURAN:
1. Gunakan BM standard Malaysia (BUKAN Bahasa Indonesia).
2. Ringkas, padat, sesuai untuk gambar produk.
3. JANGAN tambah penjelasan. Kekalkan frasa pendek jika asal pendek.
4. Nama produk: guna struktur frasa nama BM semula jadi.
5. Slogan: guna ungkapan idiomatik BM jika ada.
6. Nama tempat: kekalkan Rumi (cth: 北部湾 → Teluk Beibu).
7. Output dalam format JSON: {"1": "terjemahan1", "2": "terjemahan2", ...}
8. HANYA output JSON, tiada penjelasan.
"""


class _LocalTranslationModel:
    def __init__(self, model_dir: Path) -> None:
        import ctranslate2
        import sentencepiece as spm

        if not (model_dir / "model").is_dir() or not (model_dir / "sentencepiece.model").is_file():
            raise RuntimeError(f"Missing model: {model_dir.name}")
        self._translator = ctranslate2.Translator(
            str(model_dir / "model"), device="cpu",
            inter_threads=1, intra_threads=1, max_queued_batches=1,
        )
        model_proto = (model_dir / "sentencepiece.model").read_bytes()
        self._tokenizer = spm.SentencePieceProcessor(model_proto=model_proto)

    def translate(self, text: str) -> str:
        tokens = self._tokenizer.encode(text, out_type=str)
        result = self._translator.translate_batch(
            [tokens], replace_unknowns=True, beam_size=4, num_hypotheses=1, length_penalty=0.2,
        )[0]
        return "".join(result.hypotheses[0]).replace("\u2581", " ").strip()


class MalayTranslator:
    """Translates Chinese to Malaysian Malay using Qwen > Google > Offline."""

    def __init__(self) -> None:
        self.cache: dict[str, str] = {}
        self.qwen_count = 0
        self.online_count = 0
        self.offline_count = 0
        self.failed_count = 0
        self.qwen_failures = 0
        self.qwen_disabled = not bool(QWEN_API_KEY)
        self.online_failures = 0
        self.online_disabled = False
        self.offline_disabled = False
        self._zh_en: _LocalTranslationModel | None = None
        self._en_ms: _LocalTranslationModel | None = None

    def translate(self, text: str) -> str | None:
        source = re.sub(r"\s+", " ", text).strip(" \t\r\n")
        if not source:
            return None
        direct = NORMALIZED_ECOMMERCE_PHRASES.get(_normalize_source_phrase(source))
        if direct is not None:
            return direct
        if source in self.cache:
            cached = polish_malaysia_ecommerce(self.cache[source], source_text=source)
            if not malay_quality_issues(cached, source_text=source):
                return cached

        translated: str | None = None

        # Priority 1: Qwen
        if not self.qwen_disabled:
            result = self._translate_qwen(source)
            if result:
                candidate = polish_malaysia_ecommerce(result, source_text=source)
                if not malay_quality_issues(candidate, source_text=source):
                    translated = candidate
                    self.qwen_count += 1
                    self.qwen_failures = 0
                else:
                    self.qwen_failures += 1
                    if self.qwen_failures >= QWEN_FAILURE_LIMIT:
                        self.qwen_disabled = True
                        LOGGER.warning("Qwen disabled after %d failures", QWEN_FAILURE_LIMIT)

        # Priority 2: Google
        if not translated and not self.online_disabled:
            result = self._translate_google(source)
            if result:
                candidate = polish_malaysia_ecommerce(result, source_text=source)
                if not malay_quality_issues(candidate, source_text=source):
                    translated = candidate
                    self.online_count += 1
                    self.online_failures = 0
                else:
                    self.online_failures += 1
                    if self.online_failures >= GOOGLE_FAILURE_LIMIT:
                        self.online_disabled = True

        # Priority 3: Offline
        if not translated:
            result = self._translate_offline(source)
            if result:
                candidate = polish_malaysia_ecommerce(result, source_text=source)
                if not malay_quality_issues(candidate, source_text=source):
                    translated = candidate
                    self.offline_count += 1

        if not translated:
            self.failed_count += 1
            return None
        self.cache[source] = translated
        return translated

    def translate_batch(self, texts: list[str]) -> dict[str, str]:
        """Batch translate multiple texts via single Qwen call. Returns {text: translation}."""
        if not texts or self.qwen_disabled:
            return {}
        results: dict[str, str] = {}
        to_translate: list[str] = []
        for t in texts:
            source = re.sub(r"\s+", " ", t).strip()
            if not source:
                continue
            direct = NORMALIZED_ECOMMERCE_PHRASES.get(_normalize_source_phrase(source))
            if direct is not None:
                results[source] = direct
            elif source in self.cache:
                results[source] = self.cache[source]
            else:
                to_translate.append(source)

        if not to_translate:
            return results

        # Batch via Qwen (max 20 per call to stay within token limits)
        for i in range(0, len(to_translate), 20):
            batch = to_translate[i:i + 20]
            numbered = "\n".join(f"{idx+1}. {t}" for idx, t in enumerate(batch))
            batch_result = self._translate_qwen_batch(numbered)
            if batch_result:
                for idx, t in enumerate(batch):
                    key = str(idx + 1)
                    if key in batch_result and batch_result[key]:
                        candidate = polish_malaysia_ecommerce(batch_result[key], source_text=t)
                        if not malay_quality_issues(candidate, source_text=t):
                            results[t] = candidate
                            self.cache[t] = candidate
                            self.qwen_count += 1
            else:
                # Fallback: translate individually
                for t in batch:
                    r = self._translate_qwen(t)
                    if r:
                        candidate = polish_malaysia_ecommerce(r, source_text=t)
                        if not malay_quality_issues(candidate, source_text=t):
                            results[t] = candidate
                            self.cache[t] = candidate
                            self.qwen_count += 1
        return results

    def _translate_qwen_batch(self, numbered_text: str) -> dict[str, str] | None:
        """Send batch to Qwen and parse JSON response."""
        payload = json.dumps({
            "model": QWEN_MODEL,
            "messages": [
                {"role": "system", "content": QWEN_BATCH_SYSTEM_PROMPT},
                {"role": "user", "content": numbered_text},
            ],
            "temperature": 0.3,
            "max_tokens": 2000,
            "top_p": 0.8,
        }, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            QWEN_API_URL, data=payload,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {QWEN_API_KEY}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as resp:
                result = json.loads(resp.read().decode("utf-8"))
            choices = result.get("choices", [])
            if not choices:
                return None
            content = choices[0].get("message", {}).get("content", "")
            content = content.strip()
            if content.startswith("```"):
                content = re.sub(r"^```(?:json)?\s*", "", content)
                content = re.sub(r"\s*```$", "", content)
            parsed = json.loads(content)
            if isinstance(parsed, dict):
                return {str(k): str(v) for k, v in parsed.items()}
            return None
        except Exception as exc:
            LOGGER.warning("Qwen batch translation failed: %s", exc)
            return None

    def _translate_qwen(self, text: str) -> str | None:
        payload = json.dumps({
            "model": QWEN_MODEL,
            "messages": [
                {"role": "system", "content": QWEN_SYSTEM_PROMPT},
                {"role": "user", "content": text},
            ],
            "temperature": 0.3,
            "max_tokens": 200,
            "top_p": 0.8,
        }, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            QWEN_API_URL, data=payload,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {QWEN_API_KEY}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=QWEN_TIMEOUT_SECONDS) as resp:
                result = json.loads(resp.read().decode("utf-8"))
            choices = result.get("choices", [])
            if not choices:
                return None
            content = choices[0].get("message", {}).get("content", "")
            content = content.strip().strip('"').strip("'")
            content = re.sub(r"^(?:Terjemahan|Translation|BM|Melayu)\s*:\s*", "", content, flags=re.IGNORECASE)
            return content.strip() or None
        except Exception as exc:
            LOGGER.warning("Qwen translation failed: %s", exc)
            return None

    def _translate_google(self, text: str) -> str | None:
        data = urllib.parse.urlencode({
            "client": "gtx", "sl": "zh-CN", "tl": "ms", "dt": "t", "q": text,
        }).encode("utf-8")
        request = urllib.request.Request(
            GOOGLE_TRANSLATE_URL, data=data, headers={"User-Agent": "Mozilla/5.0"},
        )
        try:
            with urllib.request.urlopen(request, timeout=GOOGLE_TIMEOUT_SECONDS) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            segments = payload[0] if isinstance(payload, list) and payload else []
            result = "".join(
                seg[0] for seg in segments
                if isinstance(seg, list) and seg and isinstance(seg[0], str)
            )
            return result.strip() or None
        except Exception as exc:
            LOGGER.warning("Google translation failed: %s", exc)
            return None

    def _translate_offline(self, text: str) -> str | None:
        if self.offline_disabled:
            return None
        try:
            if self._zh_en is None:
                self._zh_en = _LocalTranslationModel(MODELS_DIR / "translate-zh_en-1_9")
                self._en_ms = _LocalTranslationModel(MODELS_DIR / "translate-en_ms-1_9")
            english = self._zh_en.translate(text)
            if not english or self._en_ms is None:
                return None
            return self._en_ms.translate(english)
        except Exception as exc:
            self.offline_disabled = True
            self._zh_en = None
            self._en_ms = None
            gc.collect()
            LOGGER.warning("Offline translation disabled: %s", exc)
            return None
