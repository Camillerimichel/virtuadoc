This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Document Engine Backend

A deterministic Python backend is available in `document_engine/` to validate PDF document completeness.

Run it:

```bash
cd /var/www/VirtuaDoc
python3 -m venv .venv
source .venv/bin/activate
pip install -r document_engine/requirements.txt
uvicorn document_engine.main:app --host 0.0.0.0 --port 8090 --reload
```

Endpoints:

- `POST /analyze`
- `POST /training/build-item`

## Production Delivery

Production scripts are in `scripts/prod`.

### One-shot release (compile + deploy)

```bash
cd /var/www/VirtuaDoc
./scripts/prod/release.sh
```

### Compile only

```bash
cd /var/www/VirtuaDoc
./scripts/prod/compile.sh
```

### Deploy only

```bash
cd /var/www/VirtuaDoc
./scripts/prod/deploy.sh
```

Options:

- `./scripts/prod/deploy.sh --ref main`
- `./scripts/prod/deploy.sh --skip-pull`
- `./scripts/prod/deploy.sh --allow-dirty`
