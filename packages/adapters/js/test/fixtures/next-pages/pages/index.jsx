import { useUser } from 'hooks/useUser';
import 'react';
export default function Home() { return useUser().name; }
