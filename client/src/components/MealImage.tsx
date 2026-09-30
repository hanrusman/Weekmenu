import { ReactNode, useState } from 'react';
import { findMealImage } from '../lib/mealImages';

interface MealImageProps {
  /** The recipe's own picture; tried first. */
  ownSrc?: string | null;
  recipeName: string;
  mealType: string;
  /** Pixel size of the square picture. */
  size: number;
  className?: string;
  /** Shown when neither picture is available (nothing by default). */
  fallback?: ReactNode;
}

/**
 * A recipe's picture: its own when it has one, else the stock illustration
 * whose keywords match the name, else the fallback. A picture that fails to
 * load moves on to the next.
 */
export default function MealImage({ ownSrc, recipeName, mealType, size, className = '', fallback = null }: MealImageProps) {
  // Remember which source failed, so a new source gets a fresh try
  const [failed, setFailed] = useState<string[]>([]);
  const stock = findMealImage(recipeName, mealType);

  if (ownSrc && !failed.includes(ownSrc)) {
    return (
      <img src={ownSrc} alt="" width={size} height={size} loading="lazy"
        onError={() => setFailed((f) => [...f, ownSrc])}
        className={`object-contain ${className}`} />
    );
  }

  if (stock && !failed.includes(stock)) {
    return (
      <picture>
        <source srcSet={stock.replace(/\.png$/, '.webp')} type="image/webp" />
        <img src={stock} alt="" width={size} height={size} loading="lazy"
          onError={() => setFailed((f) => [...f, stock])}
          className={`object-contain ${className}`} />
      </picture>
    );
  }

  return <>{fallback}</>;
}
