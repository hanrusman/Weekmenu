import { Clock, CheckCircle2 } from 'lucide-react';
import { RecipeData } from '../lib/api';

interface RecipeViewProps {
  recipe: RecipeData;
  recipeName: string;
  prepTime: number;
  costIndex: string;
}

const groupEmoji: Record<string, string> = {
  groenten: '🥬', fruit: '🍎', vis: '🐟', vlees: '🥩',
  zuivel: '🧀', droogwaren: '📦', kruiden: '🌿', diepvries: '❄️', overig: '🛒',
};

export default function RecipeView({ recipe, recipeName, prepTime, costIndex }: RecipeViewProps) {
  const { nutrition_per_serving: n } = recipe;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
          {recipeName}
        </h1>
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-1.5 text-sm text-muted">
            <Clock size={15} />
            <span>{prepTime} min</span>
          </div>
          <span className="text-sm text-muted">{costIndex}</span>
          {[
            { label: `${n.calories} kcal`, ok: true },
            { label: `${n.protein_g}g eiwit`, ok: n.protein_g >= 20 },
            { label: `${n.fiber_g}g vezels`, ok: n.fiber_g >= 6 },
            { label: `${n.iron_mg}mg ijzer`, ok: n.iron_mg >= 2 },
          ].map(({ label, ok }, i) => (
            <div key={i} className="flex items-center gap-1 text-sm font-medium">
              <CheckCircle2 size={14} className={ok ? 'text-green-500' : 'text-gray-300'} />
              <span className={ok ? '' : 'text-muted'}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
        <h2 className="font-bold text-sm tracking-wide text-accent mb-4 uppercase">
          Ingredienten (4 personen)
        </h2>
        <ul className="space-y-2">
          {recipe.ingredients.map((ing, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <span className="w-5 text-center">{groupEmoji[ing.product_group] || '•'}</span>
              <span>{ing.amount} {ing.unit} {ing.name}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
        <h2 className="font-bold text-sm tracking-wide text-accent mb-4 uppercase">
          Bereiding
        </h2>
        <ol className="space-y-4">
          {recipe.steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-warmth-500 text-white text-sm flex items-center justify-center font-bold">
                {i + 1}
              </span>
              <span className="text-sm pt-1 leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {recipe.tip && (
        <div className="bg-warmth-400/30 rounded-3xl p-6">
          <p className="text-sm text-warmth-600">
            <strong>Tip:</strong> {recipe.tip}
          </p>
        </div>
      )}
    </div>
  );
}
