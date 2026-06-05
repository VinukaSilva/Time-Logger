import logging
import sys

from .. import config, db
from ..jira_client.client import JiraClient
from ..sheets_client.client import SheetsClient

log = logging.getLogger(__name__)


def _check_jira() -> int:
    print("\n== Jira ==")
    client = JiraClient()
    me = client.myself()
    print(f"  authenticated as: {me.get('displayName')} ({me.get('emailAddress')})")
    n = client.cache_my_tickets()
    print(f"  cached {n} tickets (open + recently closed)")
    return n


def _check_sheet() -> str:
    print("\n== Google Sheet ==")
    client = SheetsClient()
    sid = client.ensure_sheet()
    print(f"  sheet ready: {client.url()}")
    return sid


def run() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    db.init()
    print(f"Config loaded from {config.ROOT / 'config.yaml'}")
    problems = 0
    try:
        _check_jira()
    except Exception as e:
        problems += 1
        print(f"  JIRA CHECK FAILED: {e}", file=sys.stderr)
    try:
        _check_sheet()
    except Exception as e:
        problems += 1
        print(f"  SHEET CHECK FAILED: {e}", file=sys.stderr)
    if problems:
        print(f"\nSetup finished with {problems} problem(s). See messages above.")
        return 1
    print("\nSetup OK.")
    return 0
