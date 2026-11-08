import os

# ---------------------------------------------------------
# 1. Thread locking MUST happen before importing numpy/sklearn
# ---------------------------------------------------------
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")

import hashlib
import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from model2vec import StaticModel
from pydantic import BaseModel, Field
from sklearn.linear_model import LogisticRegression

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [AI-FILTER] %(levelname)s: %(message)s",
)
logger = logging.getLogger("ai-filter")

MODEL_NAME = "minishlab/potion-multilingual-128M"
WEIGHTS_PATH = Path("filter_weights.json")
REG_C = 1.0  # Slightly stronger regularization for small N

# ---------------------------------------------------------
# Training data (EN + FA)
# ---------------------------------------------------------
SAFE_EXAMPLES = [
    # تکنولوژی و برنامه‌نویسی
    "How to configure Nginx reverse proxy on Ubuntu Linux server",
    "Buy STM32 microcontroller PCB board and USB-C flash drive online",
    "آموزش ساختار داده‌ها و الگوریتم‌ها در پایتون و طراحی سایت",
    "خرید اینترنتی قطعات الکترونیک، برد آردوینو، فلش مموری و ابزار صنعتی",
    "مقایسه تخصصی پردازنده‌های اینتل و ای‌ام‌دی برای رندرینگ حرفه‌ای",
    
    # پزشکی و سلامت (آکادمیک و کاربردی)
    "Clinical study on melanoma skin cancer biopsy and dermatological treatment",
    "Oncology research: Mammography screening guidelines for breast cancer",
    "مقاله پزشکی بررسی بیماری‌های پوستی، اگزما و غربالگری سرطان سینه در زنان",
    "رژیم غذایی مناسب برای کنترل دیابت نوع دو بر اساس آخرین مقالات انجمن قلب آمریکا",

    # اقتصاد و کسب‌وکار
    "بررسی تاثیر نرخ تورم بر قیمت تمام‌شده تولید در صنایع پتروشیمی",
    "تحلیل تکنیکال و فاندامنتال بازار سهام در بورس اوراق بهادار تهران",

    # سبک زندگی و عمومی
    "Easy homemade sourdough bread recipe and weekly meal prep ideas",
    "طرز تهیه نان خانگی، دستور پخت غذاهای سنتی و خلاصه بازی فوتبال دیشب",
    "راهنمای سفر به شیرز و معرفی جاهای دیدنی استان فارس همراه با نقشه"
]

DISTRACTING_EXAMPLES = [
    # محتوای نامناسب و تحریک‌آمیز (جنسی/بزرگسالان)
    "Shop women's sexy lingerie, lace bras, thongs, and sheer sleepwear",
    "Summer bikini lookbook: high cut two-piece swimwear and beachwear photos",
    "خرید اینترنتی لباس زیر زنانه فانتزی، ست سوتین و شورت توری و لباس خواب",
    "عکس‌های برهنه و نیمه‌برهنه، محتوای بزرگسالان و کانال همسریابی و صیغه",

    # زرد سلبریتی‌ها و شایعات (Celebrity Gossip & Clickbait)
    "Gallery of hot girls in summer dresses, beach babes wallpaper, and models",
    "Shocking photos of actress after plastic surgery! Leaked beach pictures",
    "گالری عکس دختران زیبا و جذاب، عکس‌های مدلینگ و اندام زنانه در ساحل",
    "تغییر چهره باورنکردنی بازیگر زن پس از عمل زیبایی! عکس‌های لو رفته و جنجالی",
    "رازهای مگو از زندگی خصوصی بازیگر معروف که تا حالا هیچ‌جا ندیده‌اید!",
    "افشاگری جنجالی همسر سابق خواننده معروف درباره دلیل جدایی‌شان!",

    # زردِ زرد (فال، طالع‌بینی، کلاهبرداری‌های زرد و معجزات دروغین)
    "راز عجیب ثروتمند شدن در ۳ روز با این طلسم باستانی و تست‌شده!",
    "فال روزانه متولدین فروردین: با این روش در عشق معجزه رخ می‌دهد!",
    "کاهش وزن ۲۰ کیلوگرمی در یک هفته بدون رژیم و ورزش! (روش ممنوعه)",
    "پیش‌بینی تکان‌دهنده بابا وانگا از آینده جهان در سال جدید"
]

model: StaticModel | None = None
WEIGHTS: np.ndarray | None = None
BIAS: float = 0.0


def l2_normalize(vecs: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    return np.divide(vecs, norms, out=np.zeros_like(vecs), where=norms != 0)


def compute_config_hash() -> str:
    """Hash model name, C parameter, and training examples to auto-invalidate cache."""
    raw = json.dumps(
        {"model": MODEL_NAME, "c": REG_C, "safe": SAFE_EXAMPLES, "dist": DISTRACTING_EXAMPLES},
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def train_and_save(expected_hash: str) -> None:
    global WEIGHTS, BIAS
    logger.info("🧠 Training Logistic Regression boundary...")

    all_texts = SAFE_EXAMPLES + DISTRACTING_EXAMPLES
    X = l2_normalize(model.encode(all_texts))
    y = np.array([0] * len(SAFE_EXAMPLES) + [1] * len(DISTRACTING_EXAMPLES))

    clf = LogisticRegression(C=REG_C, class_weight="balanced")
    clf.fit(X, y)

    WEIGHTS = clf.coef_[0].astype(np.float32)
    BIAS = float(clf.intercept_[0])

    payload = {
        "config_hash": expected_hash,
        "weights": WEIGHTS.tolist(),
        "bias": BIAS,
        "dim": int(WEIGHTS.shape[0]),
        "model": MODEL_NAME,
    }
    with open(WEIGHTS_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    logger.info(f"✅ Weights saved to {WEIGHTS_PATH} (hash={expected_hash})")


def load_weights() -> None:
    global WEIGHTS, BIAS
    expected_hash = compute_config_hash()

    if WEIGHTS_PATH.exists():
        try:
            with open(WEIGHTS_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            if data.get("config_hash") == expected_hash and data.get("model") == MODEL_NAME:
                WEIGHTS = np.array(data["weights"], dtype=np.float32)
                BIAS = float(data["bias"])
                logger.info(f"✅ Loaded cached weights from {WEIGHTS_PATH} (dim={WEIGHTS.shape[0]})")
                return
            logger.info("♻️ Training data or model changed; retraining weights...")
        except Exception as e:
            logger.warning(f"⚠️ Failed to read {WEIGHTS_PATH} ({e}); retraining...")

    train_and_save(expected_hash)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    logger.info(f"⏳ Loading {MODEL_NAME} into RAM...")
    model = StaticModel.from_pretrained(MODEL_NAME)
    load_weights()
    logger.info("✅ AI Filter service ready")
    yield


app = FastAPI(title="Semantic Safety Filter Microservice", lifespan=lifespan)


class SearchItem(BaseModel):
    id: str
    title: str
    snippet: str = ""


class FilterRequest(BaseModel):
    items: list[SearchItem] = Field(default_factory=list, max_length=500)
    threshold: float = Field(default=0.50, ge=0.0, le=1.0)


class BlockedItem(BaseModel):
    id: str
    risk_pct: float
    text: str


class FilterResponse(BaseModel):
    allowed_ids: list[str]
    blocked: list[BlockedItem]
    processing_time_ms: float
    model: str
    threshold: float


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "weights_loaded": WEIGHTS is not None,
    }


@app.post("/filter", response_model=FilterResponse)
def filter_snippets(req: FilterRequest):
    if WEIGHTS is None or model is None:
        raise HTTPException(status_code=503, detail="Filter model not ready")

    if not req.items:
        return FilterResponse(
            allowed_ids=[],
            blocked=[],
            processing_time_ms=0.0,
            model=MODEL_NAME,
            threshold=req.threshold,
        )

    t0 = time.perf_counter()

    texts = [f"{item.title} {item.snippet}".strip() for item in req.items]
    vecs = l2_normalize(model.encode(texts))

    logits = vecs @ WEIGHTS + BIAS
    probs = 1.0 / (1.0 + np.exp(-logits))

    allowed_ids: list[str] = []
    blocked: list[BlockedItem] = []

    for item, prob in zip(req.items, probs):
        p = float(prob)
        if p < req.threshold:
            allowed_ids.append(item.id)
        else:
            blocked.append(
                BlockedItem(
                    id=item.id,
                    risk_pct=round(p * 100.0, 1),
                    text=f"{item.title}\n{item.snippet}".strip()[:140],
                )
            )

    elapsed = (time.perf_counter() - t0) * 1000
    logger.info(f"⚡ Filtered {len(req.items)} items in {elapsed:.2f} ms")

    return FilterResponse(
        allowed_ids=allowed_ids,
        blocked=blocked,
        processing_time_ms=round(elapsed, 2),
        model=MODEL_NAME,
        threshold=req.threshold,
    )