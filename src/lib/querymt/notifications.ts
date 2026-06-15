let requestedPermission = false;

function shouldNotifyInBackground(): boolean {
  if (typeof document === 'undefined') {
    return true;
  }

  return document.visibilityState !== 'visible' || (typeof document.hasFocus === 'function' && !document.hasFocus());
}

export async function sendDesktopNotification(title: string, body: string) {
  if (typeof Notification === 'undefined' || !shouldNotifyInBackground()) {
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
