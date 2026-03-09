"use client";

import { useState, useCallback } from "react";
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { CONTRACTS, LENDER_ABI } from "@/lib/contracts";
import { parseEther } from "viem";

export interface LendingOperation {
  status: "idle" | "pending" | "success" | "error";
  hash?: string;
  error?: string;
}

export function useDepositCollateral() {
  const { writeContract, isPending, data: hash } = useWriteContract();
  const { isLoading: isMining, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const [error, setError] = useState<string | null>(null);

  const deposit = useCallback(
    (amountETH: number) => {
      setError(null);
      try {
        writeContract(
          {
            address: CONTRACTS.lender,
            abi: LENDER_ABI,
            functionName: "depositCollateral",
            value: parseEther(amountETH.toString()),
          },
          {
            onError: (err) => {
              const msg = err instanceof Error ? err.message : "Deposit failed";
              setError(msg);
            },
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error processing deposit";
        setError(msg);
      }
    },
    [writeContract],
  );

  return {
    deposit,
    isPending: isPending || isMining,
    isSuccess,
    hash,
    error,
  };
}

/**
 * Hook: Borrow funds (issues credit in stablecoin)
 */
export function useBorrow() {
  const { writeContract, isPending, data: hash } = useWriteContract();
  const { isLoading: isMining, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const [error, setError] = useState<string | null>(null);

  const borrow = useCallback(
    (amountETH: number) => {
      setError(null);
      try {
        writeContract(
          {
            address: CONTRACTS.lender,
            abi: LENDER_ABI,
            functionName: "borrow",
            args: [parseEther(amountETH.toString())],
          },
          {
            onError: (err) => {
              const msg = err instanceof Error ? err.message : "Borrow failed";
              setError(msg);
            },
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error processing borrow";
        setError(msg);
      }
    },
    [writeContract],
  );

  return {
    borrow,
    isPending: isPending || isMining,
    isSuccess,
    hash,
    error,
  };
}

/**
 * Hook: Repay borrowed funds (with accrued interest)
 */
export function useRepay() {
  const { writeContract, isPending, data: hash } = useWriteContract();
  const { isLoading: isMining, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const [error, setError] = useState<string | null>(null);

  const repay = useCallback(
    (amountETH: number) => {
      setError(null);
      try {
        writeContract(
          {
            address: CONTRACTS.lender,
            abi: LENDER_ABI,
            functionName: "repay",
            value: parseEther(amountETH.toString()),
          },
          {
            onError: (err) => {
              const msg = err instanceof Error ? err.message : "Repay failed";
              setError(msg);
            },
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error processing repay";
        setError(msg);
      }
    },
    [writeContract],
  );

  return {
    repay,
    isPending: isPending || isMining,
    isSuccess,
    hash,
    error,
  };
}

/**
 * Hook: Withdraw collateral (only if health factor allows)
 */
export function useWithdrawCollateral() {
  const { writeContract, isPending, data: hash } = useWriteContract();
  const { isLoading: isMining, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const [error, setError] = useState<string | null>(null);

  const withdraw = useCallback(
    (amountETH: number) => {
      setError(null);
      try {
        writeContract(
          {
            address: CONTRACTS.lender,
            abi: LENDER_ABI,
            functionName: "withdrawCollateral",
            args: [parseEther(amountETH.toString())],
          },
          {
            onError: (err) => {
              const msg = err instanceof Error ? err.message : "Withdrawal failed";
              setError(msg);
            },
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error processing withdrawal";
        setError(msg);
      }
    },
    [writeContract],
  );

  return {
    withdraw,
    isPending: isPending || isMining,
    isSuccess,
    hash,
    error,
  };
}

/**
 * Manager: Handle full lending lifecycle
 */
export function useLendingLifecycle() {
  const deposit = useDepositCollateral();
  const borrow = useBorrow();
  const repay = useRepay();
  const withdraw = useWithdrawCollateral();

  const executeFlow = useCallback(
    async (flow: "deposit" | "borrow" | "repay" | "withdraw", amountETH: number) => {
      switch (flow) {
        case "deposit":
          deposit.deposit(amountETH);
          break;
        case "borrow":
          borrow.borrow(amountETH);
          break;
        case "repay":
          repay.repay(amountETH);
          break;
        case "withdraw":
          withdraw.withdraw(amountETH);
          break;
      }
    },
    [deposit, borrow, repay, withdraw],
  );

  return {
    executeFlow,
    deposit,
    borrow,
    repay,
    withdraw,
  };
}
