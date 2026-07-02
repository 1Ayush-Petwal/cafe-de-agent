import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, CafeDto } from '../api/client';

export function CafeListPage() {
  const [cafes, setCafes] = useState<CafeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listCafes()
      .then(setCafes)
      .catch(() => setError('Could not load cafés'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading cafés…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <h1>Cafés in Delhi</h1>
      <ul className="cafe-list">
        {cafes.map((cafe) => (
          <li key={cafe.id}>
            <Link to={`/cafes/${cafe.id}`}>
              <strong>{cafe.name}</strong>
              <span className="area">{cafe.area}</span>
              <p>{cafe.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
