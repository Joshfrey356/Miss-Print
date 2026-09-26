"use client";
import { useRouter } from "next/navigation";
import { Archive, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { useServerAction } from "@/components/use-action";
import { setArticleArchived } from "../actions";

export function ArchiveButton({ id, archived, title }: { id: number; archived: boolean; title: string }) {
  const [pending, run] = useServerAction();
  const router = useRouter();
  if (archived)
    return (
      <Button variant="primary" disabled={pending} onClick={() => run(() => setArticleArchived(id, false))}>
        <RotateCcw className="size-4" /> Restore
      </Button>
    );
  return (
    <Confirm
      title={`Archive “${title}”?`}
      description="It will be hidden from everyone. You can restore it later from the archived list."
      confirmLabel="Archive"
      onConfirm={() => run(() => setArticleArchived(id, true), { onSuccess: () => router.push("/knowledge") })}
    >
      <Button disabled={pending}>
        <Archive className="size-4" /> Archive
      </Button>
    </Confirm>
  );
}
