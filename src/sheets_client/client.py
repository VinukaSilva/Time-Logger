import logging
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from .. import config, kv

log = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]

HEADERS = [
    "Date",
    "Start Time",
    "End Time",
    "Duration (min)",
    "Ticket",
    "Summary",
    "Description",
    "Project",
    "Submitted At",
]

SHEET_TAB = "Log"
SHEET_ID_KEY = "google_sheet_id"
TOKEN_FILENAME = "google_token.json"


def _token_path() -> Path:
    return config.google_oauth_client_path().parent / TOKEN_FILENAME


def _load_creds() -> Credentials:
    token_file = _token_path()
    client_file = config.google_oauth_client_path()
    if not client_file.exists():
        raise FileNotFoundError(f"Google OAuth client JSON not found at {client_file}")
    creds: Credentials | None = None
    if token_file.exists():
        creds = Credentials.from_authorized_user_file(str(token_file), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(client_file), SCOPES)
            creds = flow.run_local_server(port=0, open_browser=True)
        token_file.parent.mkdir(parents=True, exist_ok=True)
        token_file.write_text(creds.to_json(), encoding="utf-8")
    return creds


class SheetsClient:
    def __init__(self) -> None:
        self.creds = _load_creds()
        self.sheets = build("sheets", "v4", credentials=self.creds, cache_discovery=False)

    def _get_sheet_id(self) -> str | None:
        return kv.get(SHEET_ID_KEY) or config.sheet_id()

    def ensure_sheet(self) -> str:
        sid = self._get_sheet_id()
        if sid:
            return sid
        title = config.sheet_title()
        log.info("creating new Google Sheet: %s", title)
        result = self.sheets.spreadsheets().create(
            body={
                "properties": {"title": title},
                "sheets": [{"properties": {"title": SHEET_TAB}}],
            },
            fields="spreadsheetId,spreadsheetUrl,sheets.properties.sheetId",
        ).execute()
        sid = result["spreadsheetId"]
        kv.set(SHEET_ID_KEY, sid)
        tab_id = result["sheets"][0]["properties"]["sheetId"]
        self._apply_header_and_format(sid, tab_id)
        log.info("sheet ready at https://docs.google.com/spreadsheets/d/%s", sid)
        return sid

    def _apply_header_and_format(self, sid: str, tab_id: int) -> None:
        self.sheets.spreadsheets().values().update(
            spreadsheetId=sid,
            range=f"{SHEET_TAB}!A1:I1",
            valueInputOption="RAW",
            body={"values": [HEADERS]},
        ).execute()
        self.sheets.spreadsheets().batchUpdate(
            spreadsheetId=sid,
            body={
                "requests": [
                    {
                        "repeatCell": {
                            "range": {"sheetId": tab_id, "startRowIndex": 0, "endRowIndex": 1},
                            "cell": {"userEnteredFormat": {"textFormat": {"bold": True}}},
                            "fields": "userEnteredFormat.textFormat.bold",
                        }
                    },
                    {
                        "updateSheetProperties": {
                            "properties": {"sheetId": tab_id, "gridProperties": {"frozenRowCount": 1}},
                            "fields": "gridProperties.frozenRowCount",
                        }
                    },
                ]
            },
        ).execute()

    def append_row(self, row: list) -> None:
        sid = self.ensure_sheet()
        self.sheets.spreadsheets().values().append(
            spreadsheetId=sid,
            range=f"{SHEET_TAB}!A:I",
            valueInputOption="USER_ENTERED",
            body={"values": [row]},
        ).execute()

    def url(self) -> str | None:
        sid = self._get_sheet_id()
        return f"https://docs.google.com/spreadsheets/d/{sid}" if sid else None
