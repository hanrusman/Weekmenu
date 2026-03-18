import { RecipeData } from '../lib/api';

interface RecipeViewProps {
  recipe: RecipeData;
  recipeName: string;
  prepTime: number;
  costIndex: string;
}

const groupEmoji: Record<string, string> = {
  groenten: '🥬',
  fruit: '🍎',
  vis: '🐟',
  vlees: '🥩',
  zuivel: '🧀',
  droogwaren: '📦',
  kruiden: '🌿',
  diepvries: '❄️',
  overig: '🛒',
};

export default function RecipeView({ recipe, recipeName, prepTime, costIndex }: RecipeViewProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-forest-700 dark:text-forest-500 mb-2">
          {recipeName}
        </h1>
        <div className="flex gap-4 text-sm text-gray-600 dark:text-gray-400">
          <span>{prepTime} min</span>
          <span>{costIndex}</span>
          <span>{recipe.nutrition_per_serving.calories} kcal</span>
          <span>Vezels: {recipe.nutrition_per_serving.fiber_g}g</span>
          <span>IJzer: {recipe.nutrition_per_serving.iron_mg}mg</span>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3 text-forest-600 dark:text-forest-500">
          Ingrediënten (4 personen)
        </h2>
        <ul className="space-y-1.5">
          {recipe.ingredients.map((ing, i) => (
            <li key={i} className="flex gap-2 text-gray-700 dark:text-gray-300">
              <span className="w-5 text-center">{groupEmoji[ing.product_group] || '•'}</span>
              <span>
                {ing.amount} {ing.unit} {ing.name}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3 text-forest-600 dark:text-forest-500">
          Bereiding
        </h2>
        <ol className="space-y-3">
          {recipe.steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-forest-500 text-white text-sm flex items-center justify-center font-medium">
                {i + 1}
              </span>
              <span className="text-gray-700 dark:text-gray-300 pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {recipe.tip && (
        <div className="bg-amber-50 dark:bg-amber-900/30 rounded-xl p-4">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            💡 <strong>Tip:</strong> {recipe.tip}
          </p>
        </div>
      )}
    </div>
  );
}
