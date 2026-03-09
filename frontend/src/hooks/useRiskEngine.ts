"use client";

import { useEffect, useState, useMemo } from "react";
import { useAccount, useReadContract } from "wagmi";
import { parseAbi } from "viem";
import {
  CONTRACTS,
  LENDER_ABI,
  ATTESTATION_ABI,
  FEED_ABI,
} from "@/lib/contracts";
import type { MockPositionData, CreditScoreResult } from "@/lib/risk-engine";
import { calculateCreditScore } from "@/lib/risk-engine";

const AAVE_V3_POOL_SEPOLIA = "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951" as const;
const AAVE_POOL_ABI = parseAbi([
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
]);
const AAVE_HF_NO_DEBT =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";
export interface UserPositions {
  loading: boolean;
  error: string | null;
  positions: MockPositionData[];
  totalCollateralUSD: number;
  totalDebtUSD: number;
  unifiedHealthFactor: number;
}

export interface UserCreditScore {
  loading: boolean;
  error: string | null;
  score: CreditScoreResult | null;
  fetchedAt: number;
}

export interface UserLoan {
  collateralETH: number;
  collateralUSD: number;
  borrowedAmount: number;   // ETH
  borrowedUSD: number;
  interestAccrued: number;  // ETH
  healthFactor: number;
  maxBorrowETH: number;     
  tier: number;
}

export interface UserLoanState {
  loading: boolean;
  error: string | null;
  loans: UserLoan[];
  totalBorrowedETH: number;
  totalBorrowed: number;    
}

export function useLiveETHPrice(): number {
  const { data } = useReadContract({
    address: CONTRACTS.ethUsdFeed,
    abi: FEED_ABI,
    functionName: "latestRoundData",
    query: { refetchInterval: 15_000 },
  });
  if (!data || !Array.isArray(data) || data.length < 2) return 0;
  return Math.abs(Number((data as unknown as bigint[])[1])) / 1e8;
}

export function useLiveBTCPrice(): number {
  const { data } = useReadContract({
    address: CONTRACTS.btcUsdFeed,
    abi: FEED_ABI,
    functionName: "latestRoundData",
    query: { refetchInterval: 15_000 },
  });
  if (!data || !Array.isArray(data) || data.length < 2) return 0;
  return Math.abs(Number((data as unknown as bigint[])[1])) / 1e8;
}

const MORPHO_API = "https://blue-api.morpho.org/graphql";

async function fetchMorphoPositions(
  address: string,
): Promise<MockPositionData[]> {
  try {
    const query = `{
      userByAddress(address: "${address.toLowerCase()}", chainId: 11155111) {
        marketPositions {
          market {
            collateralAsset { symbol decimals priceUsd }
            loanAsset { symbol decimals }
          }
          collateral
          borrowAssets
        }
      }
    }`;

    const res = await fetch(MORPHO_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) return [];

    const json: {
      data?: {
        userByAddress?: {
          marketPositions?: Array<{
            market: {
              collateralAsset?: {
                symbol: string;
                decimals: number;
                priceUsd: string;
              };
              loanAsset?: { symbol: string; decimals: number };
            };
            collateral: string;
            borrowAssets: string;
          }>;
        };
      };
    } = await res.json();

    const raw = json?.data?.userByAddress?.marketPositions ?? [];

    return raw
      .filter(
        (p) => Number(p.collateral) > 0 || Number(p.borrowAssets) > 0,
      )
      .map((p) => {
        const coll = p.market.collateralAsset;
        const loan = p.market.loanAsset;
        const collDecimals = coll?.decimals ?? 18;
        const loanDecimals = loan?.decimals ?? 6;
        const collUSD =
          (Number(p.collateral) / 10 ** collDecimals) *
          Number(coll?.priceUsd ?? 0);
        const debtUSD = Number(p.borrowAssets) / 10 ** loanDecimals;

        return {
          protocol: "morpho" as const,
          chain: "sepolia",
          collateralAsset: coll?.symbol ?? "UNKNOWN",
          collateralAmount: BigInt(p.collateral),
          debtAsset: loan?.symbol ?? "UNKNOWN",
          debtAmount: BigInt(p.borrowAssets),
          collateralUSD: collUSD,
          debtUSD,
        };
      });
  } catch {
    return [];
  }
}

export function useUserPositions(): UserPositions {
  const { address } = useAccount();
  const { data: aaveData, isLoading: aaveLoading } = useReadContract({
    address: AAVE_V3_POOL_SEPOLIA,
    abi: AAVE_POOL_ABI,
    functionName: "getUserAccountData",
    args: address ? [address as `0x${string}`] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 30_000,
    },
  });
  const [morphoPositions, setMorphoPositions] = useState<MockPositionData[]>([]);
  const [morphoLoading, setMorphoLoading] = useState(true);

  useEffect(() => {
    if (!address) {
      setMorphoPositions([]);
      setMorphoLoading(false);
      return;
    }

    let cancelled = false;
    setMorphoLoading(true);

    fetchMorphoPositions(address).then((positions) => {
      if (!cancelled) {
        setMorphoPositions(positions);
        setMorphoLoading(false);
      }
    });

    const id = setInterval(() => {
      fetchMorphoPositions(address).then((positions) => {
        if (!cancelled) setMorphoPositions(positions);
      });
    }, 60_000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [address]);
  const positions = useMemo<MockPositionData[]>(() => {
    const result: MockPositionData[] = [];

    if (aaveData && Array.isArray(aaveData) && aaveData.length >= 2) {
      const [totalCollateralBase, totalDebtBase] = aaveData as unknown as bigint[];
      const collateralUSD = Number(totalCollateralBase) / 1e8;
      const debtUSD = Number(totalDebtBase) / 1e8;
      if (collateralUSD > 0.01 || debtUSD > 0.01) {
        result.push({
          protocol: "aave",
          chain: "sepolia",
          collateralAsset: "Multi-Asset",
          collateralAmount: totalCollateralBase,
          debtAsset: "Multi-Asset",
          debtAmount: totalDebtBase,
          collateralUSD,
          debtUSD,
        });
      }
    }

    result.push(...morphoPositions);
    return result;
  }, [aaveData, morphoPositions]);

  const totalCollateralUSD = useMemo(
    () => positions.reduce((s, p) => s + p.collateralUSD, 0),
    [positions],
  );
  const totalDebtUSD = useMemo(
    () => positions.reduce((s, p) => s + p.debtUSD, 0),
    [positions],
  );
  const unifiedHealthFactor =
    totalDebtUSD > 0
      ? totalCollateralUSD / totalDebtUSD
      : totalCollateralUSD > 0
        ? 999
        : 0;

  return {
    loading: !address ? false : aaveLoading || morphoLoading,
    error: null,
    positions,
    totalCollateralUSD,
    totalDebtUSD,
    unifiedHealthFactor,
  };
}

export function useUserCreditScore(
  positions: MockPositionData[],
): UserCreditScore {
  return useMemo<UserCreditScore>(() => {
    if (positions.length === 0) {
      return { loading: false, error: null, score: null, fetchedAt: 0 };
    }
    try {
      return {
        loading: false,
        error: null,
        score: calculateCreditScore(positions),
        fetchedAt: Date.now(),
      };
    } catch (err) {
      return {
        loading: false,
        error: err instanceof Error ? err.message : "Failed to calculate score",
        score: null,
        fetchedAt: Date.now(),
      };
    }
  }, [positions]);
}

export function useUserLoans(ethPrice: number = 0): UserLoanState {
  const { address } = useAccount();

  const { data: positionData, isLoading } = useReadContract({
    address: CONTRACTS.lender,
    abi: LENDER_ABI,
    functionName: "getPosition",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  const { data: maxBorrowData } = useReadContract({
    address: CONTRACTS.lender,
    abi: LENDER_ABI,
    functionName: "getMaxBorrow",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  const loans: UserLoan[] = [];
  let totalBorrowedETH = 0;
  let error: string | null = null;

  if (positionData && Array.isArray(positionData) && positionData.length >= 5) {
    try {
      const [collateral, borrowed, interest, tier, hf] =
        positionData as unknown as bigint[];

      const collateralETH = Number(collateral) / 1e18;
      const borrowedAmount = Number(borrowed) / 1e18;
      const interestAccrued = Number(interest) / 1e18;
      const healthFactor =
        hf.toString() === AAVE_HF_NO_DEBT || Number(hf) === 0
          ? collateralETH > 0
            ? 999
            : 0
          : Number(hf) / 10_000;

      const maxBorrowETH =
        maxBorrowData && Array.isArray(maxBorrowData) && maxBorrowData.length >= 1
          ? Number((maxBorrowData as unknown as bigint[])[0]) / 1e18
          : 0;

      if (collateralETH > 0 || borrowedAmount > 0) {
        loans.push({
          collateralETH,
          collateralUSD: collateralETH * ethPrice,
          borrowedAmount,
          borrowedUSD: borrowedAmount * ethPrice,
          interestAccrued,
          healthFactor,
          maxBorrowETH,
          tier: Number(tier),
        });
        totalBorrowedETH = borrowedAmount;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to parse position";
    }
  }

  return {
    loading: isLoading,
    error,
    loans,
    totalBorrowedETH,
    totalBorrowed: totalBorrowedETH * ethPrice,
  };
}

export function useAttestation() {
  const { address } = useAccount();

  const { data, isLoading, isError, refetch } = useReadContract({
    address: CONTRACTS.attestation,
    abi: ATTESTATION_ABI,
    functionName: "verifyAttestation",
    args: address ? [address as `0x${string}`, 1] : undefined,
    query: { enabled: !!address, refetchInterval: 5_000 },
  });

  const arr = Array.isArray(data) ? (data as unknown[]) : [];
  const isValid = arr.length > 0 ? Boolean(arr[0]) : false;
  const tier = arr.length > 1 ? Number(arr[1]) : 0;
  const expiry = arr.length > 2 ? BigInt(arr[2] as bigint | number) : BigInt(0);
  console.log("attestation raw data:", data, "isError:", isError, "address:", address); 
  return { isValid, tier, expiry, isLoading, isContractError: isError, refetch };
}
