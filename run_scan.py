import json
import logging

from src.git_scanner.scanner import scan_all

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    result = scan_all()
    print(json.dumps(result, indent=2))
