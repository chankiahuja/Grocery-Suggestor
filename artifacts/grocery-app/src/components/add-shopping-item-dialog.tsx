import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAddShoppingListItem,
  useUpdateShoppingListItem,
  getGetShoppingListQueryKey,
} from '@workspace/api-client-react';
import type { ShoppingListItem } from '@workspace/api-client-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { isInvalidUnit } from '@/lib/inventory-units';
import { UnitSelector } from '@/components/unit-selector';

const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  category: z.string().min(1, 'Category is required'),
  quantity: z.coerce.number().min(0, 'Quantity must be 0 or greater'),
  unit: z.string()
    .trim()
    .min(1, 'Unit is required')
    .max(64, 'Unit must be 64 characters or fewer')
    .refine((value) => !isInvalidUnit(value), 'Choose a unit or enter a custom text unit'),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface AddShoppingItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shoppingListId: number;
  item?: ShoppingListItem;
  onItemUpdated?: (item: ShoppingListItem) => void;
}

export function AddShoppingItemDialog({
  open,
  onOpenChange,
  shoppingListId,
  item,
  onItemUpdated,
}: AddShoppingItemDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addItem = useAddShoppingListItem();
  const updateItem = useUpdateShoppingListItem();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      category: '',
      quantity: 1,
      unit: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      name: item?.name ?? '',
      category: item?.category ?? '',
      quantity: item?.quantity ?? 1,
      unit: item?.unit ?? '',
      notes: item?.notes ?? '',
    });
  }, [form, item, open]);

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
      if (item) {
        const updatedItem = await updateItem.mutateAsync({
          id: shoppingListId,
          itemId: item.id,
          data: {
            quantity: values.quantity,
            unit: values.unit,
            notes: values.notes,
          },
        });
        onItemUpdated?.(updatedItem);
      } else {
        await addItem.mutateAsync({
          id: shoppingListId,
          data: {
            ...values,
            notes: values.notes || undefined,
          },
        });
      }

      toast({
        title: item ? 'Item updated' : 'Item added',
        description: `${values.name} ${item ? 'updated' : 'added'} ${item ? 'in' : 'to'} the shopping list.`,
      });

      queryClient.invalidateQueries({
        queryKey: getGetShoppingListQueryKey(shoppingListId),
      });

      onOpenChange(false);
      form.reset();
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to ${item ? 'update' : 'add'} item. Please try again.`,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={item ? "dialog-edit-shopping-item" : "dialog-add-shopping-item"}>
        <DialogHeader>
          <DialogTitle>{item ? "Edit Shopping List Item" : "Add Item to Shopping List"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={Boolean(item)} placeholder="e.g. Bread" data-testid="input-shopping-item-name" />
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
                      <Input {...field} disabled={Boolean(item)} placeholder="e.g. Bakery" data-testid="input-shopping-item-category" />
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
                        selectTestId="input-shopping-item-unit"
                        customInputTestId="input-shopping-item-custom-unit"
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
                  <FormItem className="col-span-2">
                    <FormLabel>Quantity</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.1" {...field} data-testid="input-shopping-item-quantity" />
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
                      <Textarea {...field} placeholder="Additional notes..." data-testid="input-shopping-item-notes" />
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
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} data-testid="button-add-shopping-item">
                {isSubmitting ? (item ? 'Updating...' : 'Adding...') : (item ? 'Update Item' : 'Add Item')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
