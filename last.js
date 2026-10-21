// GET /api/last?mint=<mint>&min=0.1 -> { hourStart, winner, sol, slot, sig }
// First $FIRST buy (>= min SOL) that landed on-chain after the latest :00:00 UTC. Needs env HELIUS_API_KEY.
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export default async function handler(req, res) {
  const mint = String(req.query.mint || ''); const min = Math.max(0, parseFloat(req.query.min) || 0.1);
  if (!B58.test(mint)) return res.status(400).json({ error: 'bad mint' });
  const key = process.env.HELIUS_API_KEY; if (!key) return res.status(500).json({ error: 'HELIUS_API_KEY not set' });
  const hourStart = Math.floor(Date.now() / 3600000) * 3600000;
  try {
    let before = '', best = null;
    for (let page = 0; page < 10; page++) {
      const url = `https://api.helius.xyz/v0/addresses/${mint}/transactions?api-key=${key}&limit=100${before ? '&before=' + before : ''}`;
      const txs = await fetch(url).then((r) => r.json());
      if (!Array.isArray(txs) || !txs.length) break;
      let older = false;
      txs.forEach((t, i) => {
        if (t.timestamp * 1000 < hourStart) { older = true; return; }
        const buyer = t.feePayer;
        const got = (t.tokenTransfers || []).some((x) => x.mint === mint && x.toUserAccount === buyer && x.tokenAmount > 0);
        if (!got) return;
        const sol = (t.nativeTransfers || []).filter((n) => n.fromUserAccount === buyer).reduce((s, n) => s + n.amount, 0) / 1e9;
        if (sol < min) return;
        // the API lists newest first, so later index = earlier inside the same slot
        const rank = t.slot * 1000 - i;
        if (!best || rank < best.rank) best = { rank, winner: buyer, sol, slot: t.slot, sig: t.signature };
      });
      if (older) break;
      before = txs[txs.length - 1].signature;
    }
    res.setHeader('cache-control', 's-maxage=15, stale-while-revalidate=30');
    if (!best) return res.json({ hourStart, winner: null });
    const { rank, ...out } = best;
    res.json({ hourStart, ...out });
  } catch (e) { res.status(502).json({ error: 'upstream' }); }
}
