interface MetalPrice {
  price: number;
  updatedAt: string;
  source: "kitco" | "gold-api";
}

interface KitcoMetalResult {
  ask?: number;
  bid?: number;
  mid?: number;
  originalTime?: string;
  timestamp?: number;
}

interface KitcoMetalQuote {
  results?: KitcoMetalResult[];
}

async function fetchFromKitco(): Promise<{ gold: MetalPrice; silver: MetalPrice } | null> {
  try {
    const res = await fetch("https://www.kitco.com/price/precious-metals", {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) return null;

    const nextData = JSON.parse(match[1]);
    const queries: { queryKey: unknown[]; state: { data: unknown } }[] =
      nextData?.props?.pageProps?.dehydratedState?.queries ?? [];
    const quoteQuery = queries.find((q) => q.queryKey?.includes("allMetalsQuote"));
    const data = quoteQuery?.state?.data as
      | { gold?: KitcoMetalQuote; silver?: KitcoMetalQuote }
      | undefined;
    if (!data) return null;

    const toPrice = (quote: KitcoMetalQuote | undefined): MetalPrice | null => {
      const r = quote?.results?.[0];
      const price = r?.mid ?? r?.ask;
      if (!price) return null;
      const updatedAt = r?.originalTime ?? (r?.timestamp ? new Date(r.timestamp * 1000).toISOString() : new Date().toISOString());
      return { price, updatedAt, source: "kitco" };
    };

    const gold = toPrice(data.gold);
    const silver = toPrice(data.silver);
    if (!gold || !silver) return null;
    return { gold, silver };
  } catch {
    return null;
  }
}

async function fetchFromGoldApi(symbol: "XAU" | "XAG"): Promise<MetalPrice | null> {
  try {
    const res = await fetch(`https://api.gold-api.com/price/${symbol}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { price: data.price, updatedAt: data.updatedAt, source: "gold-api" };
  } catch {
    return null;
  }
}

export async function GET() {
  const kitco = await fetchFromKitco();
  if (kitco) {
    return Response.json(kitco);
  }

  // Kitco's page structure changed or was unreachable — fall back to a secondary source.
  const [gold, silver] = await Promise.all([fetchFromGoldApi("XAU"), fetchFromGoldApi("XAG")]);
  return Response.json({ gold, silver });
}
