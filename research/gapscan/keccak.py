"""Pure-Python Keccak-256 (the Ethereum variant, not NIST SHA3-256).

Small and slow, but we only hash event signatures, selectors and pool keys,
so it keeps the research tool free of third-party dependencies.
"""

_RC = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
]

_ROT = [
    [0, 36, 3, 41, 18],
    [1, 44, 10, 45, 2],
    [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39, 8, 14],
]

_MASK = (1 << 64) - 1
_RATE = 136  # bytes, for a 256-bit output


def _rol(v: int, n: int) -> int:
    n %= 64
    return ((v << n) | (v >> (64 - n))) & _MASK


def _permute(a: list[list[int]]) -> None:
    for rc in _RC:
        c = [a[x][0] ^ a[x][1] ^ a[x][2] ^ a[x][3] ^ a[x][4] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rol(c[(x + 1) % 5], 1) for x in range(5)]
        for x in range(5):
            for y in range(5):
                a[x][y] ^= d[x]
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = _rol(a[x][y], _ROT[x][y])
        for x in range(5):
            for y in range(5):
                a[x][y] = b[x][y] ^ ((~b[(x + 1) % 5][y]) & b[(x + 2) % 5][y])
        a[0][0] ^= rc


def keccak256(data: bytes) -> bytes:
    msg = bytearray(data)
    msg.append(0x01)
    while len(msg) % _RATE:
        msg.append(0x00)
    msg[-1] |= 0x80

    a = [[0] * 5 for _ in range(5)]
    for off in range(0, len(msg), _RATE):
        block = msg[off:off + _RATE]
        for i in range(_RATE // 8):
            lane = int.from_bytes(block[8 * i:8 * i + 8], "little")
            a[i % 5][i // 5] ^= lane
        _permute(a)

    out = bytearray()
    for i in range(4):
        out += a[i % 5][i // 5].to_bytes(8, "little")
    return bytes(out)


def selector(signature: str) -> str:
    """4-byte function selector, e.g. selector("decimals()") -> "0x313ce567"."""
    return "0x" + keccak256(signature.encode()).hex()[:8]


def topic(signature: str) -> str:
    """32-byte event topic for an event signature."""
    return "0x" + keccak256(signature.encode()).hex()
