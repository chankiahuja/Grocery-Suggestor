import { ArrowLeft, Info, MapPin, Tags } from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  getGetShoppingListQueryKey,
  useGetShoppingList,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type StoreQuote = {
  name: string;
  price: number;
  matched: number;
  best?: boolean;
};

const sampleBasket = [
  { name: "Amul toned milk", quantity: "2 × 1 L" },
  { name: "Basmati rice", quantity: "1 × 5 kg" },
  { name: "Whole wheat atta", quantity: "1 × 5 kg" },
];

const quotes: StoreQuote[] = [
  { name: "Blinkit", price: 789, matched: 3 },
  { name: "Zepto", price: 762, matched: 3, best: true },
  { name: "Instamart", price: 815, matched: 3 },
  { name: "BigBasket", price: 779, matched: 3 },
];

function formatPrice(price: number) {
  return `₹${price.toLocaleString("en-IN")}`;
}

export default function ComparePrices() {
  const [location] = useLocation();
  const params = new URLSearchParams(location.split("?")[1] ?? "");
  const listId = Number(params.get("listId"));
  const hasList = Number.isInteger(listId) && listId > 0;
  const { data: list, isLoading } = useGetShoppingList(hasList ? listId : 0, {
    query: {
      enabled: hasList,
      queryKey: getGetShoppingListQueryKey(hasList ? listId : 0),
    },
  });

  const basket = list?.items.length
    ? list.items.slice(0, 3).map((item) => ({
        name: item.name,
        quantity: `${item.quantity} ${item.unit}`,
      }))
    : sampleBasket;
  const basketLabel = list?.name ?? "Sample basket";
  const matchedCount = basket.length;

  return (
    <Layout>
      <div className="space-y-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="pantry-eyebrow mb-3">A little perspective on price.</div>
            <h2 className="text-3xl font-normal tracking-tight">Compare prices</h2>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              See how this basket could compare across familiar grocery services.
            </p>
          </div>
          <Link href={hasList ? `/shopping-lists/${listId}` : "/shopping-lists"}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to shopping list
            </Button>
          </Link>
        </div>

        <div className="compare-callout">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <strong>Illustrative prices only.</strong> These sample quotes show the
            comparison experience. They are not live retailer prices and do not
            include delivery, handling, or member offers.
          </p>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <Tags className="h-3.5 w-3.5" />
              {basketLabel}
            </div>
            <h3 className="mt-2 text-xl font-medium">{matchedCount} matched essentials</h3>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" /> Gurugram · demo location
          </div>
        </div>

        {isLoading ? (
          <div className="compare-price-grid" aria-label="Loading price comparison">
            {quotes.map((quote) => <div className="compare-store compare-store-loading" key={quote.name} />)}
          </div>
        ) : (
          <div className="compare-price-grid">
            {quotes.map((quote) => (
              <Card className={`compare-store ${quote.best ? "compare-store-best" : ""}`} key={quote.name}>
                <CardContent className="p-5">
                  <div className="compare-store-label">
                    {quote.best ? "Lowest sample subtotal" : "Sample item subtotal"}
                  </div>
                  <h3 className="mt-3 text-lg font-semibold">{quote.name}</h3>
                  <div className="compare-price">{formatPrice(quote.price)}</div>
                  <p className="text-sm text-muted-foreground">
                    {Math.min(quote.matched, matchedCount)} of {matchedCount} sample products matched
                  </p>
                  <p className="mt-5 text-xs leading-5 text-muted-foreground">
                    Delivery &amp; handling: unverified<br />
                    Member offers: excluded
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Card className="compare-detail-card">
          <CardContent className="p-6 sm:p-7">
            <h3 className="text-lg font-semibold">Compare like with like.</h3>
            <div className="mt-4 grid gap-2 text-sm text-muted-foreground">
              {basket.map((item) => (
                <div className="flex flex-wrap justify-between gap-3 border-b border-border/70 pb-2" key={`${item.name}-${item.quantity}`}>
                  <span>{item.name}</span>
                  <span>{item.quantity}</span>
                </div>
              ))}
            </div>
            <p className="mt-5 text-sm leading-6 text-muted-foreground">
              The lowest item subtotal may not be the lowest checkout total. A connected
              version would need location-specific availability, exact product matches,
              and applicable fees.
            </p>
            <Link href={hasList ? `/shopping-lists/${listId}` : "/shopping-lists"} className="mt-5 inline-flex text-sm font-medium text-primary hover:underline">
              ← Back to your shopping list
            </Link>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
