import { ChatPanel } from "./chat-panel";
import { jobNo } from "@/lib/format";
import type { ChatMessage, ChatUser } from "@/lib/messages/types";

export type { ChatMessage, ChatUser } from "@/lib/messages/types";

/**
 * Job chat — drop into the job page:
 *
 *   const [messages, users] = await Promise.all([getJobMessages(user.tenantId, job.id), getActiveUsers(user.tenantId)]);
 *   <JobChat jobId={job.id} jobNumber={job.number} jobPrefix={prefix} messages={messages} users={users} currentUserId={user.id} />
 *
 * Posts through postMessage() (lib/messages/actions), which handles @mentions, notifications,
 * attachments (saved to the job's Working Files) and the job's activity log.
 */
export function JobChat({
  jobId,
  jobNumber,
  jobPrefix,
  messages,
  users,
  currentUserId,
  canAttach = true,
  className,
  listClassName,
}: {
  jobId: number;
  jobNumber: number;
  /** The shop's job number prefix (tenants.jobPrefix). */
  jobPrefix: string;
  messages: ChatMessage[];
  users: ChatUser[];
  currentUserId: number;
  /** Hide the attach button (e.g. roles without files.upload). */
  canAttach?: boolean;
  className?: string;
  /** Height of the scrolling message area (default max-h-[32rem]). */
  listClassName?: string;
}) {
  return (
    <ChatPanel
      target={{ jobId }}
      messages={messages}
      users={users}
      currentUserId={currentUserId}
      canAttach={canAttach}
      placeholder={`Message about ${jobNo(jobNumber, jobPrefix)}… (type @ to mention someone)`}
      emptyTitle="No messages on this job yet"
      emptyDescription="Questions, updates and photos about this job go here. Type @ to get someone's attention."
      className={className}
      listClassName={listClassName}
    />
  );
}
