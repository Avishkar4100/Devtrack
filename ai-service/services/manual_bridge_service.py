import json
import threading
import time
import uuid
from typing import Any, Dict, List, Optional


class ManualBridgeService:
    def __init__(self):
        self._lock = threading.RLock()
        self._cond = threading.Condition(self._lock)
        self._requests: Dict[str, Dict[str, Any]] = {}

    def submit_and_wait(
        self,
        prompt: str,
        operation: str,
        timeout_seconds: int,
        context: Optional[Dict[str, Any]] = None,
    ) -> str:
        request_id = str(uuid.uuid4())
        now = time.time()

        record = {
            "id": request_id,
            "operation": operation,
            "status": "pending",
            "prompt": prompt,
            "context": context or {},
            "responseText": None,
            "error": None,
            "createdAt": now,
            "updatedAt": now,
        }

        with self._cond:
            self._requests[request_id] = record
            self._cond.notify_all()

            deadline = now + max(1, int(timeout_seconds))
            while True:
                current = self._requests.get(request_id)
                if not current:
                    raise RuntimeError("Manual bridge request disappeared")

                if current["status"] == "resolved":
                    return str(current.get("responseText") or "")

                if current["status"] == "rejected":
                    reason = current.get("error") or "Manual bridge request was rejected"
                    raise RuntimeError(str(reason))

                remaining = deadline - time.time()
                if remaining <= 0:
                    current["status"] = "timed_out"
                    current["updatedAt"] = time.time()
                    raise TimeoutError("Manual bridge request timed out waiting for human response")

                self._cond.wait(timeout=min(1.0, remaining))

    def list_requests(self, status: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
        with self._lock:
            items = list(self._requests.values())

        if status:
            items = [item for item in items if item.get("status") == status]

        items.sort(key=lambda x: x.get("createdAt", 0), reverse=True)
        return items[: max(1, min(limit, 500))]

    def get_request(self, request_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            return self._requests.get(request_id)

    def resolve_request(self, request_id: str, response_text: str) -> Dict[str, Any]:
        with self._cond:
            item = self._requests.get(request_id)
            if not item:
                raise KeyError("Request not found")

            item["status"] = "resolved"
            item["responseText"] = response_text
            item["updatedAt"] = time.time()
            self._cond.notify_all()
            return item

    def reject_request(self, request_id: str, error_message: str) -> Dict[str, Any]:
        with self._cond:
            item = self._requests.get(request_id)
            if not item:
                raise KeyError("Request not found")

            item["status"] = "rejected"
            item["error"] = error_message
            item["updatedAt"] = time.time()
            self._cond.notify_all()
            return item

    def stats(self) -> Dict[str, Any]:
        with self._lock:
            values = list(self._requests.values())

        def _count(name: str) -> int:
            return sum(1 for v in values if v.get("status") == name)

        return {
            "total": len(values),
            "pending": _count("pending"),
            "resolved": _count("resolved"),
            "rejected": _count("rejected"),
            "timed_out": _count("timed_out"),
        }


manual_bridge_service = ManualBridgeService()
