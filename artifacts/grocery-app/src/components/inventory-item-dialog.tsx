import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateInventoryItem,
  useUpdateInventoryItem,
  getListInventoryItemsQueryKey,
  getGetInventoryStatsQueryKey,
  getGetGrocerySuggestionsQueryKey,
} from "@workspace/api-client-react";
import type {
  InventoryItem,
  InventoryItemInput,
  InventoryItemUpdate,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useNotifications } from "@/hooks/use-notifications";
import { isInvalidUnit } from "@/lib/inventory-units";
import { UnitSelector } from "@/components/unit-selector";

function nullableValue(value: string | undefined) {
  return value === "" || value === undefined ? null : value;
}

const nonBlankNumber = (label: string) =>
  z.preprocess(
    (value) => {
      if (typeof value === "string" && value.trim() === "") return undefined;
      return typeof value === "number" ? value : Number(value);
    },
    z
      .number({
        required_error: `${label} is required`,
        invalid_type_error: `${label} must be a number`,
      })
      .finite(`${label} must be a valid number`)
      .min(0, `${label} must be 0 or greater`),
  );

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().min(1, "Category is required"),
  quantity: nonBlankNumber("Quantity"),
  unit: z.string()
    .trim()
    .min(1, "Unit is required")
    .max(64, "Unit must be 64 characters or fewer")
    .refine((value) => !isInvalidUnit(value), "Choose a unit or enter a custom text unit"),
  minThreshold: nonBlankNumber("Threshold"),
  expiresAt: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface InventoryItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: InventoryItem;
}

export function InventoryItemDialog({
  open,
  onOpenChange,
  item,
}: InventoryItemDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { notifyOutOfStock } = useNotifications();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [focusNameAfterSave, setFocusNameAfterSave] = useState(false);
  const submitIntent = useRef<"close" | "continue">("close");
  const dialogSession = useRef(0);
  const openState = useRef(open);
  const activeSubmission = useRef<number | null>(null);
  const nextSubmission = useRef(0);

  const createItem = useCreateInventoryItem();
  const updateItem = useUpdateInventoryItem();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: item?.name || "",
      category: item?.category || "",
      quantity: item?.quantity || 0,
      unit: item?.unit || "",
      minThreshold: item?.minThreshold || 0,
      expiresAt: item?.expiresAt || "",
      notes: item?.notes || "",
    },
  });

  useEffect(() => {
    if (openState.current !== open) {
      openState.current = open;
      dialogSession.current += 1;
      if (!open) {
        activeSubmission.current = null;
        setIsSubmitting(false);
        setFocusNameAfterSave(false);
      }
    }

    if (!open) return;

    form.reset({
      name: item?.name || "",
      category: item?.category || "",
      quantity: item?.quantity || 0,
      unit: item?.unit || "",
      minThreshold: item?.minThreshold || 0,
      expiresAt: item?.expiresAt || "",
      notes: item?.notes || "",
    });
  }, [form, item, open]);

  useEffect(() => {
    if (!open || !focusNameAfterSave) return;

    form.setFocus("name");
    setFocusNameAfterSave(false);
  }, [focusNameAfterSave, form, open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (openState.current !== nextOpen) {
      openState.current = nextOpen;
      dialogSession.current += 1;
    }
    if (!nextOpen) {
      submitIntent.current = "close";
      activeSubmission.current = null;
      setIsSubmitting(false);
      setFocusNameAfterSave(false);
    }
    onOpenChange(nextOpen);
  };

  const handleInvalidSubmit = () => {
    submitIntent.current = "close";
  };

  const onSubmit = async (values: FormValues) => {
    if (isSubmitting || activeSubmission.current !== null) return;

    const shouldContinue = !item && submitIntent.current === "continue";
    submitIntent.current = "close";
    const submissionSession = dialogSession.current;
    const submissionId = ++nextSubmission.current;
    activeSubmission.current = submissionId;
    const isCurrentSubmission = () =>
      dialogSession.current === submissionSession &&
      activeSubmission.current === submissionId;
    setIsSubmitting(true);
    try {
      if (item) {
        const update: InventoryItemUpdate = {
          ...values,
          revision: item.revision,
          expiresAt: nullableValue(values.expiresAt),
          notes: nullableValue(values.notes),
        };
        await updateItem.mutateAsync({
          id: item.id,
          data: update,
        });
        if (isCurrentSubmission()) {
          if (values.quantity === 0) {
            notifyOutOfStock(values.name);
            toast({
              title: `${values.name} is out of stock`,
              description: "Consider adding it to a shopping list.",
              variant: "destructive",
            });
          } else {
            toast({
              title: "Item updated",
              description: `${values.name} has been updated.`,
            });
          }
        }
      } else {
        const input: InventoryItemInput = {
          ...values,
          expiresAt: nullableValue(values.expiresAt),
          notes: nullableValue(values.notes),
        };
        await createItem.mutateAsync({
          data: input,
        });
        if (isCurrentSubmission()) {
          if (values.quantity === 0) {
            notifyOutOfStock(values.name);
            toast({
            title: `${values.name} added — and already out of stock`,
            description: shouldContinue
              ? "Add your next item."
              : "Consider adding it to a shopping list right away.",
            variant: "destructive",
            });
          } else {
            toast({
              title: "Item added",
              description: shouldContinue
                ? `${values.name} added. Add your next item.`
                : `${values.name} has been added to inventory.`,
            });
          }
        }
      }

      queryClient.invalidateQueries({
        queryKey: getListInventoryItemsQueryKey(),
      });
      queryClient.invalidateQueries({
        queryKey: getGetInventoryStatsQueryKey(),
      });
      queryClient.invalidateQueries({
        queryKey: getGetGrocerySuggestionsQueryKey(),
      });

      if (!isCurrentSubmission()) return;

      if (shouldContinue) {
        form.reset({
          name: "",
          category: values.category,
          quantity: 0,
          unit: values.unit,
          minThreshold: 0,
          expiresAt: "",
          notes: "",
        });
        setFocusNameAfterSave(true);
      } else {
        handleOpenChange(false);
        form.reset();
      }
    } catch (error) {
      if (isCurrentSubmission()) {
        toast({
          title: "Error",
          description: "Failed to save item. Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      if (isCurrentSubmission()) {
        activeSubmission.current = null;
        setIsSubmitting(false);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-inventory-item">
        <DialogHeader>
          <DialogTitle>{item ? "Edit Item" : "Add New Item"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit, handleInvalidSubmit)}
            onInvalidCapture={handleInvalidSubmit}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        disabled={isSubmitting}
                        placeholder="e.g. Milk"
                        data-testid="input-item-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        disabled={isSubmitting}
                        placeholder="e.g. Dairy"
                        data-testid="input-item-category"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="unit"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Unit</FormLabel>
                    <FormControl>
                      <UnitSelector
                        key={`${item?.id ?? "new"}-${open}`}
                        value={field.value}
                        onChange={field.onChange}
                        disabled={isSubmitting}
                        selectTestId="input-item-unit"
                        customInputTestId="input-item-custom-unit"
                        invalid={fieldState.invalid}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current Quantity</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.1"
                        {...field}
                        disabled={isSubmitting}
                        data-testid="input-item-quantity"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="minThreshold"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Min Threshold</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.1"
                        {...field}
                        disabled={isSubmitting}
                        data-testid="input-item-threshold"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="expiresAt"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Expires At (optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        disabled={isSubmitting}
                        data-testid="input-item-expires"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Notes (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        disabled={isSubmitting}
                        placeholder="Additional notes..."
                        data-testid="input-item-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant={item ? "default" : "outline"}
                disabled={isSubmitting}
                onClick={() => {
                  submitIntent.current = "close";
                }}
                data-testid="button-save-item"
              >
                {isSubmitting ? "Saving..." : item ? "Update" : "Save item"}
              </Button>
              {!item && (
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  onClick={() => {
                    submitIntent.current = "continue";
                  }}
                  data-testid="button-save-and-add-another"
                >
                  {isSubmitting ? "Saving..." : "Save & add another"}
                </Button>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
