"use client";
import { Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { useServerAction } from "@/components/use-action";
import { archiveCustomer, restoreCustomer } from "../actions";

export function ArchiveCustomerButton({ id, name, archived }: { id: number; name: string; archived: boolean }) {
  const [pending, run] = useServerAction();
  if (archived)
    return (
      <Button disabled={pending} onClick={() => run(() => restoreCustomer(id))}>
        <ArchiveRestore className="size-4" />
        Restore customer
      </Button>
    );
  return (
    <Confirm
      title={`Archive ${name}?`}
      description="They'll be hidden from the customer list. Their jobs, quotes and invoices stay as they are, and you can restore them any time."
      confirmLabel="Archive customer"
      onConfirm={async () => {
        const r = await archiveCustomer(id);
        if (r.ok) toast.success("Customer archived");
        else toast.error(r.error);
      }}
    >
      <Button variant="ghost" className="text-slate-600">
        <Archive className="size-4" />
        Archive
      </Button>
    </Confirm>
  );
}
