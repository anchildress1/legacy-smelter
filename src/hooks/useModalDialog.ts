import { useEffect, useRef, type RefObject } from 'react';

export function useModalDialog(
  onClose: () => void,
): RefObject<HTMLDialogElement | null> {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    // Capture the element that triggered the dialog so focus can be
    // returned when the dialog closes. Native <dialog>.close() only
    // restores focus reliably when the dialog stays in the DOM — React
    // unmounts the component on close, so we restore manually.
    triggerRef.current = document.activeElement;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  return dialogRef;
}
