// Чтение баланса токена PERSONA по кошельку через Triton RPC.
// Активно когда в env есть TOKEN_CA + RPC_URL; до лонча server.js живёт на демо-балансе.
async function getTokenBalance(wallet) {
  const res = await fetch(process.env.RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [wallet, { mint: process.env.TOKEN_CA }, { encoding: 'jsonParsed' }],
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`rpc: ${j.error.message}`);
  return (j.result?.value || []).reduce(
    (s, a) => s + Number(a.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0), 0,
  );
}

module.exports = { getTokenBalance };
