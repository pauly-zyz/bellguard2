"""Offline tests: python -m unittest discover -s tests"""

import math
import unittest
from datetime import date, datetime, timezone

from gapscan.abi import decode_string, enc_address, word_signed
from gapscan.analysis import (Swap, active_notional, fee_income, full_range_il,
                              lp_markout, stock_price)
from gapscan.calendar import closed_windows, is_closed
from gapscan.chain import TOPIC_INITIALIZE, TOPIC_SWAP
from gapscan.keccak import keccak256, selector
from gapscan.pools import Pool
from gapscan.report import CoverTerms, build_report, payout_usd

UTC = timezone.utc
Q96 = 2 ** 96


def sqrt_x96(raw_price: float) -> int:
    return int(math.sqrt(raw_price) * Q96)


def pool(stock_is_token0: bool) -> Pool:
    # stock: 18 decimals, USDG: 6 decimals, 0.3% fee
    if stock_is_token0:
        return Pool("v3", "0xp", "0xp", "0xstock", "0xusdg", 18, 6, "TSLA", "USDG", 3000, True)
    return Pool("v3", "0xp", "0xp", "0xusdg", "0xstock", 6, 18, "USDG", "TSLA", 3000, False)


class KeccakTest(unittest.TestCase):
    def test_vectors(self):
        self.assertEqual(keccak256(b"").hex(),
                         "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470")
        self.assertEqual(selector("transfer(address,uint256)"), "0xa9059cbb")
        self.assertEqual(selector("decimals()"), "0x313ce567")

    def test_abc_vector(self):
        self.assertEqual(keccak256(b"abc").hex(),
                         "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45")

    def test_permutation_matches_hashlib_sha3_on_long_inputs(self):
        # NIST SHA3-256 = same permutation and rate, padding byte 0x06 instead of 0x01.
        # Re-pad with 0x06 and compare against hashlib to check multi-block absorb.
        import hashlib
        from gapscan import keccak as k

        def sha3_256(data: bytes) -> bytes:
            msg = bytearray(data) + b"\x06"
            while len(msg) % k._RATE:
                msg.append(0)
            msg[-1] |= 0x80
            a = [[0] * 5 for _ in range(5)]
            for off in range(0, len(msg), k._RATE):
                block = msg[off:off + k._RATE]
                for i in range(k._RATE // 8):
                    a[i % 5][i // 5] ^= int.from_bytes(block[8 * i:8 * i + 8], "little")
                k._permute(a)
            return b"".join(a[i % 5][i // 5].to_bytes(8, "little") for i in range(4))

        for n in (0, 1, 135, 136, 137, 271, 272, 500):
            data = bytes(range(256)) * 2
            self.assertEqual(sha3_256(data[:n]), hashlib.sha3_256(data[:n]).digest(), n)

    def test_uniswap_v4_topics(self):
        # Verified against live PoolManager logs on Robinhood Chain
        self.assertEqual(TOPIC_INITIALIZE,
                         "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438")
        self.assertEqual(TOPIC_SWAP,
                         "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f")


class AbiTest(unittest.TestCase):
    def test_signed(self):
        self.assertEqual(word_signed((1 << 256) - 5, 256), -5)
        self.assertEqual(word_signed((1 << 256) - 5, 128), -5)
        self.assertEqual(word_signed(7, 24), 7)

    def test_decode_string(self):
        data = "0x" + format(32, "064x") + format(4, "064x") + b"TSLA".hex().ljust(64, "0")
        self.assertEqual(decode_string(data), "TSLA")
        self.assertEqual(decode_string("0x" + b"MKR".hex().ljust(64, "0")), "MKR")

    def test_enc_address(self):
        self.assertEqual(enc_address("0xABC"), "0" * 61 + "abc")


class CalendarTest(unittest.TestCase):
    def test_weekend_is_saturday_to_monday_2am_berlin(self):
        ws = closed_windows(datetime(2026, 10, 9, tzinfo=UTC), datetime(2026, 10, 13, tzinfo=UTC))
        self.assertEqual(len(ws), 1)
        # CEST (UTC+2): 02:00 Berlin = 00:00 UTC
        self.assertEqual(ws[0].start, datetime(2026, 10, 10, 0, 0, tzinfo=UTC))
        self.assertEqual(ws[0].end, datetime(2026, 10, 12, 0, 0, tzinfo=UTC))

    def test_dst_change_inside_weekend(self):
        # Europe leaves summer time on 2026-10-25, during the weekend
        ws = closed_windows(datetime(2026, 10, 23, tzinfo=UTC), datetime(2026, 10, 27, tzinfo=UTC))
        self.assertEqual(ws[0].hours, 49.0)

    def test_monday_holiday_merges_with_weekend(self):
        ws = closed_windows(datetime(2026, 9, 4, tzinfo=UTC), datetime(2026, 9, 9, tzinfo=UTC))
        self.assertEqual(len(ws), 1)
        self.assertIn("Labor Day", ws[0].label)
        self.assertEqual(ws[0].hours, 72.0)

    def test_midweek_holiday(self):
        ws = closed_windows(datetime(2026, 11, 25, tzinfo=UTC), datetime(2026, 11, 27, 12, tzinfo=UTC))
        self.assertEqual([w.label for w in ws], ["Thanksgiving Day"])

    def test_is_closed(self):
        self.assertTrue(is_closed(datetime(2026, 10, 11, 12, tzinfo=UTC)))   # Sunday
        self.assertFalse(is_closed(datetime(2026, 10, 14, 12, tzinfo=UTC)))  # Wednesday

    def test_custom_holidays(self):
        ws = closed_windows(datetime(2026, 10, 13, tzinfo=UTC), datetime(2026, 10, 16, tzinfo=UTC),
                            holidays={date(2026, 10, 14): "test"})
        self.assertEqual([w.label for w in ws], ["test"])

    def test_naive_datetimes_rejected(self):
        with self.assertRaises(ValueError):
            closed_windows(datetime(2026, 1, 1), datetime(2026, 1, 2))


class PriceMathTest(unittest.TestCase):
    def test_stock_price_both_orientations(self):
        # $250 per stock. token0=stock(18), token1=USDG(6): raw = 250 * 1e6 / 1e18
        p0 = pool(True)
        self.assertAlmostEqual(stock_price(p0, sqrt_x96(250 * 1e6 / 1e18)), 250, places=6)
        # token0=USDG(6), token1=stock(18): raw = (1/250) * 1e18 / 1e6
        p1 = pool(False)
        self.assertAlmostEqual(stock_price(p1, sqrt_x96(1e18 / 1e6 / 250)), 250, places=6)

    def test_markout_sign(self):
        # Weekend buyer takes 1 stock out at $100 (pool gets 100 USDG). Reopen at $110:
        # LPs gave away something worth 110 for 100 -> markout -10.
        p = pool(True)
        s = Swap(1, 0, -10 ** 18, 100 * 10 ** 6, 0, 0, 3000)
        self.assertAlmostEqual(lp_markout(p, [s], 110.0), -10.0)
        # Same trade, but the price reopens at $95: LPs gained.
        self.assertAlmostEqual(lp_markout(p, [s], 95.0), 5.0)

    def test_markout_orientation_independent(self):
        a = Swap(1, 0, -10 ** 18, 100 * 10 ** 6, 0, 0, 3000)  # stock token0
        b = Swap(1, 0, 100 * 10 ** 6, -10 ** 18, 0, 0, 3000)  # stock token1
        self.assertAlmostEqual(lp_markout(pool(True), [a], 110),
                               lp_markout(pool(False), [b], 110))

    def test_fee_income(self):
        # User sells 1 stock into the pool: fee is 0.3% of the input, valued at ref price.
        s = Swap(1, 0, 10 ** 18, -99 * 10 ** 6, 0, 0, 3000)
        self.assertAlmostEqual(fee_income(pool(True), [s], 100.0), 0.3)

    def test_active_notional_orientation_independent(self):
        L = 10 ** 15
        a = Swap(1, 0, 0, 0, sqrt_x96(250 * 1e6 / 1e18), L, 3000)
        b = Swap(1, 0, 0, 0, sqrt_x96(1e18 / 1e6 / 250), L, 3000)
        na, nb = active_notional(pool(True), a), active_notional(pool(False), b)
        self.assertGreater(na, 0)
        self.assertAlmostEqual(na, nb, delta=na * 1e-9)

    def test_full_range_il(self):
        self.assertEqual(full_range_il(0.0), 0.0)
        self.assertAlmostEqual(full_range_il(0.10), full_range_il(1 / 1.10 - 1), places=12)
        self.assertAlmostEqual(full_range_il(3.0), 0.2, places=12)  # classic 4x -> 20%


class ReportTest(unittest.TestCase):
    def row(self, markout, notional=1_000_000, volume=500_000, **kw):
        r = {"window": "weekend", "window_start": "2026-10-10T00:00:00+00:00",
             "pool": "TSLA/USDG v3 0.3%", "gap": -0.02, "markout_usd": markout,
             "markout_bps": markout / notional * 1e4, "notional_usd": notional,
             "volume_usd": volume, "fees_usd": 100.0, "p_close": 100.0, "p_reopen": 98.0,
             "quote_usd": 1.0, "flags": []}
        r.update(kw)
        return r

    def test_payout_deductible_and_cap(self):
        t = CoverTerms(deductible_bps=25, cap_bps=100, loading=1.0)
        self.assertEqual(payout_usd(self.row(+5_000), t), 0.0)           # LP gained
        self.assertEqual(payout_usd(self.row(-2_000), t), 0.0)           # under deductible
        self.assertAlmostEqual(payout_usd(self.row(-5_000), t), 2_500)   # 5000 - 2500
        self.assertAlmostEqual(payout_usd(self.row(-50_000), t), 10_000) # capped at 1%

    def test_report_renders(self):
        rows = [self.row(-5_000), self.row(1_000),
                self.row(-1, flags=["reopen_not_settled"])]
        text = build_report(rows, CoverTerms(25, 500, 1.5))
        self.assertIn("usable: 2", text)
        self.assertIn("Break-even surcharge", text)


if __name__ == "__main__":
    unittest.main()
