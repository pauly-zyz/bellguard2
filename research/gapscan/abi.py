"""Tiny ABI helpers: just enough encoding/decoding for the calls we make."""

from __future__ import annotations

from .keccak import selector


def words(data: str) -> list[int]:
    """Split hex call/log data into 32-byte unsigned words."""
    raw = data[2:] if data.startswith("0x") else data
    return [int(raw[i:i + 64], 16) for i in range(0, len(raw), 64)]


def to_signed(value: int, bits: int = 256) -> int:
    value &= (1 << bits) - 1
    return value - (1 << bits) if value >> (bits - 1) else value


def word_signed(word: int, bits: int) -> int:
    """Read a sign-extended intN that was ABI-encoded into a 256-bit word."""
    return to_signed(word, 256) if bits == 256 else to_signed(word & ((1 << bits) - 1), bits)


def address_from_word(word: int) -> str:
    return "0x" + format(word & ((1 << 160) - 1), "040x")


def address_from_topic(topic: str) -> str:
    return "0x" + topic[-40:].lower()


def enc_address(addr: str) -> str:
    return addr.lower().removeprefix("0x").rjust(64, "0")


def enc_bytes32(value: str) -> str:
    v = value.lower().removeprefix("0x")
    if len(v) != 64:
        raise ValueError("bytes32 must be 32 bytes")
    return v


def enc_uint(value: int) -> str:
    return format(value, "064x")


def call_data(signature: str, *encoded_args: str) -> str:
    return selector(signature) + "".join(encoded_args)


def decode_string(data: str, offset_word: int = 0) -> str:
    """Decode an ABI dynamic string whose head offset sits at word `offset_word`.

    Also accepts legacy bytes32-returning tokens (non-standard symbol()).
    """
    raw = bytes.fromhex(data.removeprefix("0x"))
    if len(raw) == 32:  # bytes32-style string
        return raw.rstrip(b"\x00").decode(errors="replace")
    off = int.from_bytes(raw[32 * offset_word:32 * offset_word + 32], "big")
    length = int.from_bytes(raw[off:off + 32], "big")
    return raw[off + 32:off + 32 + length].decode(errors="replace")
