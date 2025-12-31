import { createSignal, For, onMount, onCleanup } from "solid-js";
import { config } from "../config";
import Icon from "./Icon";
import "./NotificationsCenter.css";

interface Notification {
  id: string;
  submission_id: string;
  recipient_id?: string;
  type: "approved" | "rejected" | "under_review" | "submission";
  title: string;
  message: string;
  created_at: string;
  read: boolean;
}

const API_URL = config.apiUrl;

interface NotificationsCenterProps {
  onNotificationClick?: (submissionId: string) => void;
}

const NotificationsCenter = (props: NotificationsCenterProps) => {
  const [notifications, setNotifications] = createSignal<Notification[]>([]);
  const [isOpen, setIsOpen] = createSignal(false);
  const [unreadCount, setUnreadCount] = createSignal(0);

  let pollInterval: number | undefined;

  const fetchNotifications = async () => {
    try {
      const response = await fetch(`${API_URL}/api/notifications?unread_only=false`);
      if (response.ok) {
        const data = await response.json();
        setNotifications(data);
        setUnreadCount(data.filter((n: Notification) => !n.read).length);
      }
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    // Mark as read
    if (!notification.read) {
      await markAsRead(notification.id);
    }

    // Navigate to submission
    if (props.onNotificationClick) {
      props.onNotificationClick(notification.submission_id);
    }

    // Close panel
    setIsOpen(false);
  };

  const markAsRead = async (id: string) => {
    try {
      await fetch(`${API_URL}/api/notifications/${id}/read`, {
        method: "POST"
      });
      setNotifications(notifications().map(n =>
        n.id === id ? { ...n, read: true } : n
      ));
      setUnreadCount(Math.max(0, unreadCount() - 1));
    } catch (error) {
      console.error("Failed to mark as read:", error);
    }
  };

  onMount(() => {
    fetchNotifications();
    // Poll every 2 minutes (120000ms)
    pollInterval = setInterval(fetchNotifications, 120000) as unknown as number;
  });

  onCleanup(() => {
    if (pollInterval) clearInterval(pollInterval);
  });

  return (
    <div class="notifications-wrapper">
      <button
        class="notifications-bell"
        onClick={() => setIsOpen(!isOpen())}
        title="Notifications"
      >
        <Icon name="bell" size={20} />
        {unreadCount() > 0 && (
          <span class="notification-badge">{unreadCount()}</span>
        )}
      </button>

      {isOpen() && (
        <div class="notifications-panel">
          <div class="notifications-header">
            <h3>Notifications</h3>
            <button
              class="close-btn"
              onClick={() => setIsOpen(false)}
            >
              ×
            </button>
          </div>

          <div class="notifications-list">
            {notifications().length === 0 ? (
              <div class="notifications-empty">No notifications</div>
            ) : (
              <For each={notifications()}>
                {(notification) => (
                  <div
                    class={`notification-item ${!notification.read ? "unread" : ""} ${notification.type}`}
                    onClick={() => handleNotificationClick(notification)}
                    style={{ cursor: "pointer" }}
                  >
                    <div class="notification-icon">
                      {notification.type === "approved" && "✓"}
                      {notification.type === "rejected" && "✗"}
                      {notification.type === "under_review" && "⏳"}
                      {notification.type === "submission" && "📥"}
                    </div>
                    <div class="notification-content">
                      <div class="notification-title">{notification.title}</div>
                      <div class="notification-message">{notification.message}</div>
                      <div class="notification-time">
                        {new Date(notification.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                )}
              </For>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationsCenter;
