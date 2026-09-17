"""Shared logging setup for the API process and every standalone worker.

Keeps one consistent format and quiets the third-party libraries that log a
line per HTTP call (httpx/httpcore, used by both the Qdrant client and the
OpenAI SDK). Left at INFO, those alone produced ~2,400 log lines for a single
600-CV matching job — noise, since our own code already logs the meaningful
summaries (job started, chunk done, LLM analysis complete, job finished).
WARNING and above from these libraries still comes through.
"""

import logging

_NOISY_LOGGERS = ("httpx", "httpcore", "urllib3")


def configure_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    for name in _NOISY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
