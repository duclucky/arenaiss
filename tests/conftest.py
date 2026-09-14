"""Project-local Windows compatibility for genlayer-test direct mode.

genlayer-test unlinks the temporary stdin file immediately after
dup2(). POSIX permits that, while Windows keeps the file locked through fd 0.
Retain those files until pytest has restored stdin, without modifying the
installed package. Import SDK types through the v0.3 compatibility helpers so
the hook follows the current runner layout.
"""

from __future__ import annotations

import os
import json
import tempfile
from pathlib import Path

import pytest


_RETAINED_STDIN_FILES: list[Path] = []


@pytest.fixture(scope="session", autouse=True)
def windows_genlayer_direct_stdin_compat():
    if os.name != "nt":
        yield
        return

    from gltest.direct import loader
    from gltest.direct.vm import VMContext

    original = loader._inject_message_to_fd0
    original_mock_llm = VMContext.mock_llm

    def mock_json_text(self, prompt_pattern, response):
        # Consensus v0.6's JSON response decoder consumes raw JSON text. The
        # RC2 direct runner auto-decodes one JSON layer, so preserve the text
        # boundary in the same way as the official v2-dev test helper.
        return original_mock_llm(self, prompt_pattern, json.dumps(response))

    def inject_without_early_unlink(vm):
        # gltest adds the contract SDK to sys.path immediately before invoking
        # this hook, so these imports must remain lazy.
        from gltest.direct.sdk_compat import import_address, import_calldata

        calldata = import_calldata()
        Address = import_address()

        sender_addr = Address(vm.sender) if isinstance(vm.sender, bytes) else vm.sender
        contract_addr = (
            Address(vm._contract_address)
            if isinstance(vm._contract_address, bytes)
            else vm._contract_address
        )
        origin_addr = Address(vm.origin) if isinstance(vm.origin, bytes) else vm.origin
        encoded = calldata.encode(
            {
                "contract_address": contract_addr,
                "sender_address": sender_addr,
                "origin_address": origin_addr,
                "stack": [],
                "value": vm._value,
                "datetime": vm._datetime,
                "is_init": False,
                "chain_id": vm._chain_id,
                "entry_kind": 0,
                "entry_data": b"",
                "entry_stage_data": None,
            }
        )

        fd, raw_path = tempfile.mkstemp(prefix="arena-gltest-")
        path = Path(raw_path)
        try:
            os.write(fd, encoded)
            os.lseek(fd, 0, os.SEEK_SET)
            vm._original_stdin_fd = os.dup(0)
            os.dup2(fd, 0)
            _RETAINED_STDIN_FILES.append(path)
        finally:
            os.close(fd)

    loader._inject_message_to_fd0 = inject_without_early_unlink
    VMContext.mock_llm = mock_json_text
    try:
        yield
    finally:
        loader._inject_message_to_fd0 = original
        VMContext.mock_llm = original_mock_llm
        for path in _RETAINED_STDIN_FILES:
            try:
                path.unlink(missing_ok=True)
            except PermissionError:
                # The process exit will release a final OS-level handle.
                pass
