import { For } from "solid-js";
import type { ActivityTimelineProps, AssetEvent, FormattedEvent } from "../types";

const formatTimeAgo = (timestamp: number): string => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

const formatEvent = (event: AssetEvent): FormattedEvent => {
  const timeAgo = formatTimeAgo(event.timestamp);

  switch (event.type) {
    case "forked":
      return {
        icon: "🔀",
        title: "Asset Created",
        desc: `Forked from ${event.data?.original_name || "original"}`,
        time: timeAgo
      };
    case "metadata_saved":
      return {
        icon: "💾",
        title: "Changes Saved",
        desc: "Metadata updated",
        time: timeAgo
      };
    case "edited_after_publish":
      return {
        icon: "⚠️",
        title: "Edited After Publishing",
        desc: "Local changes not in submitted version",
        time: timeAgo,
        warning: true
      };
    case "published":
      return {
        icon: "⏳",
        title: "Published for Review",
        desc: `Submission ID: ${event.data?.submission_id?.substring(0, 8)}...`,
        time: timeAgo
      };
    case "thumbnail_changed":
      return {
        icon: "🖼️",
        title: "Thumbnail Updated",
        desc: "Preview image changed",
        time: timeAgo
      };
    case "file_changed":
      return {
        icon: "📝",
        title: "File Modified",
        desc: "Blender saved changes",
        time: timeAgo
      };
    case "approved":
      return {
        icon: "✅",
        title: "Approved",
        desc: `By ${event.data?.moderator || "moderator"}`,
        time: timeAgo
      };
    case "rejected":
      return {
        icon: "❌",
        title: "Rejected",
        desc: event.data?.reason || "See moderator notes",
        time: timeAgo
      };
    default:
      return {
        icon: "📌",
        title: event.type,
        desc: JSON.stringify(event.data),
        time: timeAgo
      };
  }
};

const ActivityTimeline = (props: ActivityTimelineProps) => {
  return (
    <div class="panel-section activity-timeline">
      <h3>Activity Timeline</h3>
      <div class="timeline-events">
        <For each={props.events}>
          {(event) => {
            const formatted = formatEvent(event);
            return (
              <div class={`timeline-event ${formatted.warning ? 'warning' : ''}`}>
                <div class="timeline-icon">{formatted.icon}</div>
                <div class="timeline-content">
                  <div class="timeline-title">{formatted.title}</div>
                  <div class="timeline-desc">{formatted.desc}</div>
                  <div class="timeline-time">{formatted.time}</div>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};

export default ActivityTimeline;
