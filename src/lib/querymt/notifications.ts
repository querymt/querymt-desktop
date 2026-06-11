let requestedPermission = false;

export async function sendDesktopNotification(title: string, body: string) {
  if (typeof Notification === 'undefined') {
    return;
  }

  if (Notification.permission === 'default' && !requestedPermission) {
    requestedPermission = true;
    await Notification.requestPermission();
  }

  if (Notification.permission !== 'granted') {
    return;
  }

  new Notification(title, {
    body,
    tag: 'querymt-inbox'
  });
}
