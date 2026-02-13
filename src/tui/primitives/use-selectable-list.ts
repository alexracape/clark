import { useEffect, useState } from "react";

/**
 * Shared selection state for up/down list navigation.
 */
export function useSelectableList(size: number, initial = 0) {
  const [selected, setSelected] = useState(initial);

  useEffect(() => {
    if (size <= 0) {
      setSelected(0);
      return;
    }
    if (selected >= size) {
      setSelected(size - 1);
    }
  }, [size, selected]);

  const moveUp = () => setSelected((index) => Math.max(0, index - 1));
  const moveDown = () => setSelected((index) => Math.min(Math.max(0, size - 1), index + 1));
  const reset = () => setSelected(0);

  return {
    selected,
    setSelected,
    moveUp,
    moveDown,
    reset,
  };
}
