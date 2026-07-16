export const SALES_QUOTES: string[] = [
  "Every call is a chance to build a collector for life.",
  "They didn't buy a coin — they bought a story. Keep telling it.",
  "The first 15 days decide whether a client becomes a customer or a name on a list.",
  "Follow-up is where the sale actually happens.",
  "A collector who feels understood becomes a collector who keeps buying.",
  "Silence isn't a no. It's a call you haven't made yet.",
  "Every rare coin has a story — find out why it matters to them.",
  "Trust closes more deals than pressure ever will.",
  "The best pitch is a good question, asked with real curiosity.",
  "Consistency beats intensity. Make the call today.",
  "Your enthusiasm is contagious — or it isn't. Bring it every time.",
  "A client remembered is a client retained.",
  "Great numismatists are made one honest conversation at a time.",
  "The window is short. The relationship doesn't have to be.",
];

export function pickQuote(index: number): string {
  return SALES_QUOTES[index % SALES_QUOTES.length];
}
