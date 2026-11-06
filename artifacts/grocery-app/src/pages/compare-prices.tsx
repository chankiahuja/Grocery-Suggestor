import {
  ArrowLeft,
  ArrowRight,
  Info,
  MapPin,
  RefreshCw,
  Tags,
} from "lucide-react";
import { Link, useSearch } from "wouter";
import {
  getGetShoppingListQueryKey,
  useGetShoppingList,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

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
  const search = useSearch();
  const listId = Number(new URLSearchParams(search).get("listId"));
  const hasListId = Number.isInteger(listId) && listId > 0;
  const {
    data: list,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useGetShoppingList(hasListId ? listId : 0, {
    query: {
      enabled: hasListId,
      queryKey: getGetShoppingListQueryKey(hasListId ? listId : 0),
    },
  });
  const backHref = list ? `/shopping-lists/${list.id}` : "/shopping-lists";
  const backLabel = list ? `Back to ${list.name}` : "Back to Shopping Lists";

  return (
    <Layout>
      <div className="compare-page space-y-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="pantry-eyebrow mb-3">
              A little perspective on price
            </div>
            <h2 className="text-3xl font-normal tracking-tight">
              Compare prices
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Explore how one sample basket might look across familiar grocery
              services.
            </p>
          </div>
          <Link href={backHref} className="compare-back-link">
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Link>
        </div>

        <section className="compare-summary" aria-label="Comparison context">
          <div className="compare-summary-main">
            <span className="compare-eyebrow">
              <Tags className="h-4 w-4" /> Interactive demo
            </span>
            <h3>One basket. A clearer view.</h3>
            <p>
              Compare a fixed set of three everyday essentials with sample
              subtotals.
            </p>
            <span className="compare-summary-count">
              3 matched sample items
            </span>
          </div>
          <div className="compare-list-context">
            <span className="compare-eyebrow">Your shopping list</span>
            {isLoading ? (
              <div
                role="status"
                aria-label="Loading shopping list"
                className="space-y-3 pt-4"
              >
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-28" />
              </div>
            ) : list ? (
              <>
                <h4>{list.name}</h4>
                <p>
                  {list.items.length} item{list.items.length === 1 ? "" : "s"}{" "}
                  in your list
                </p>
                <a className="compare-context-link" href="#selected-list">
                  See your items <ArrowRight className="h-4 w-4" />
                </a>
              </>
            ) : isError ? (
              <>
                <h4>List unavailable</h4>
                <p>
                  We could not load your list. The sample comparison is still
                  available.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isFetching}
                  onClick={() => void refetch()}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />{" "}
                  {isFetching ? "Retrying..." : "Try again"}
                </Button>
              </>
            ) : (
              <>
                <h4>No list selected</h4>
                <p>
                  Browse the sample basket below, or open a shopping list to see
                  its items here.
                </p>
              </>
            )}
          </div>
        </section>

        <div className="compare-callout" role="note">
          <Info className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            <strong>Illustrative prices only.</strong> These fixed sample quotes
            are not live retailer prices or quotes for your selected list.
            Delivery, handling, availability, and member offers are not
            included.
          </p>
        </div>

        <div className="compare-section-heading">
          <div>
            <span className="pantry-eyebrow">Side by side</span>
            <h3>Sample retailer subtotals</h3>
            <p>Each card uses the same three sample products.</p>
          </div>
          <span className="compare-location">
            <MapPin className="h-4 w-4" /> Gurugram · demo location
          </span>
        </div>

        <div
          className="compare-price-grid"
          aria-label="Sample retailer subtotals"
        >
          {quotes.map((quote) => (
            <Card
              className={`compare-store ${quote.best ? "compare-store-best" : ""}`}
              key={quote.name}
            >
              <CardContent className="compare-store-content">
                <span
                  className={`compare-store-label ${quote.best ? "compare-store-label-best" : ""}`}
                >
                  {quote.best
                    ? "Lowest sample subtotal"
                    : "Sample item subtotal"}
                </span>
                <h4>{quote.name}</h4>
                <div className="compare-price">{formatPrice(quote.price)}</div>
                <p className="compare-match-count">
                  {quote.matched} of {sampleBasket.length} sample products
                  matched
                </p>
                <div className="compare-store-foot">
                  <span>Delivery &amp; handling: unverified</span>
                  <span>Member offers: excluded</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="compare-detail-card">
          <CardContent className="compare-detail-content">
            <div className="compare-detail-intro">
              <span className="pantry-eyebrow">
                The items behind the numbers
              </span>
              <h3>Compare like with like.</h3>
              <p>
                The subtotals above refer to this fixed basket. Your own list is
                shown separately when you open the demo from a shopping list.
              </p>
            </div>
            <div className="compare-detail-columns">
              <section aria-label="Matched sample items">
                <h4>
                  Matched sample items <span>{sampleBasket.length}</span>
                </h4>
                <ul className="compare-item-list">
                  {sampleBasket.map((item) => (
                    <li key={item.name}>
                      <span>{item.name}</span>
                      <span>{item.quantity}</span>
                    </li>
                  ))}
                </ul>
              </section>
              {list && (
                <section
                  id="selected-list"
                  aria-label={`Items in ${list.name}`}
                >
                  <h4>
                    Your list: {list.name} <span>{list.items.length}</span>
                  </h4>
                  {list.items.length ? (
                    <ul className="compare-item-list">
                      {list.items.map((item) => (
                        <li key={item.id}>
                          <span>{item.name}</span>
                          <span>
                            {item.quantity} {item.unit}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="compare-list-empty">
                      No items in this list yet.
                    </p>
                  )}
                </section>
              )}
            </div>
            <p className="compare-detail-note">
              The lowest item subtotal may not be the lowest checkout total. A
              live comparison would need location-specific availability, exact
              product matches, and applicable fees.
            </p>
            <Link
              href={backHref}
              className="compare-back-link compare-bottom-link"
            >
              <ArrowLeft className="h-4 w-4" /> {backLabel}
            </Link>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
