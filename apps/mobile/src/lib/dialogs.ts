import { Alert, Platform } from 'react-native';

/** Cross-platform confirmation dialog (Alert on native, window.confirm on web). */
export function confirmAsync(
  title: string,
  message: string,
  confirmLabel: string,
  options: { destructive?: boolean } = {},
): Promise<boolean> {
  if (Platform.OS === 'web') {
    const fn = (globalThis as { confirm?: (msg: string) => boolean }).confirm;
    return Promise.resolve(fn ? fn(`${title}\n\n${message}`) : true);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: options.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Cross-platform informational message. */
export function notify(title: string, message: string): void {
  if (Platform.OS === 'web') {
    const fn = (globalThis as { alert?: (msg: string) => void }).alert;
    fn?.(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}
