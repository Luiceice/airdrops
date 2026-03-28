export function createUniqueAmount(plan) {
  const baseAmount = plan === "yearly" ? 39.99 : 4.99;
  const randomTail = Math.floor(Math.random() * 9) + 1;
  const amountUsdt = Number((baseAmount - randomTail / 1000).toFixed(3));
  const amountUnits = Math.round(amountUsdt * 1_000_000).toString();

  return {
    amountUsdt,
    amountUnits,
  };
}