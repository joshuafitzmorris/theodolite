# guards: log and error messages that mention SQL words are not sites
import logging

logger = logging.getLogger(__name__)


def messages():
    logger.info("INSERT failed")
    print("Update user settings")
    raise ValueError("delete from cart failed")
