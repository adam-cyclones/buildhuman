import { createSignal, For, onMount, onCleanup } from "solid-js";
import { config } from "./config";
import "./NotificationsCenter.css";

interface Notification {
  id: string;
  submission_id: string;
  recipient_id?: string;
  type: "approved" | "rejected" | "under_review";
  title: string;
  message: string;
  created_at: string;
  read: boolean;
}

const API_URL = config.apiUrl;

const NotificationsCenter = () => {
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
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
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
                    onClick={() => !notification.read && markAsRead(notification.id)}
                  >
                    <div class="notification-icon">
                      {notification.type === "approved" && "✓"}
                      {notification.type === "rejected" && "✗"}
                      {notification.type === "under_review" && "⏳"}
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
