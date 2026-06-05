import ctypes
from ctypes import wintypes

import psutil
import win32gui
import win32process

_user32 = ctypes.windll.user32
_kernel32 = ctypes.windll.kernel32


class _LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


def idle_seconds() -> int:
    lii = _LASTINPUTINFO()
    lii.cbSize = ctypes.sizeof(lii)
    _user32.GetLastInputInfo(ctypes.byref(lii))
    return int((_kernel32.GetTickCount() - lii.dwTime) / 1000)


def active_window() -> dict:
    hwnd = win32gui.GetForegroundWindow()
    if not hwnd:
        return {"window_title": "", "process_name": "", "pid": None}
    title = win32gui.GetWindowText(hwnd) or ""
    pid = None
    name = ""
    try:
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        name = psutil.Process(pid).name()
    except Exception:
        pass
    return {"window_title": title, "process_name": name, "pid": pid}
