import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { logger } from '../logger';
import { ApiErrorHandler } from '../error-handler';
import { getToken } from '../auth';

/**
 * Sanitize sensitive data from request payloads before logging
 */
export function sanitizeRequestData(data: unknown): unknown {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sensitiveFields = ['password', 'token', 'access_token', 'refresh_token', 'otp', 'secret', 'api_key', 'authorization'];
  const sanitized = { ...(data as Record<string, unknown>) };

  for (const key in sanitized) {
    const lowerKey = key.toLowerCase();
    if (sensitiveFields.some((field) => lowerKey.includes(field))) {
      sanitized[key] = '***REDACTED***';
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeRequestData(sanitized[key]);
    }
  }

  return sanitized;
}

export function createAxiosClient(): AxiosInstance {
  const client = axios.create({
    baseURL: config.apiUrl,
    timeout: config.requestTimeout,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  client.interceptors.request.use((requestConfig) => {
    if (typeof window !== 'undefined') {
      requestConfig.baseURL = window.location.origin;
    }
    const requestId = uuidv4();
    requestConfig.headers['x-request-id'] = requestId;

    if (!requestConfig.headers['Authorization']) {
      const token = getToken();
      if (token) {
        requestConfig.headers['Authorization'] = `Bearer ${token}`;
      }
    }

    const sanitizedData = sanitizeRequestData(requestConfig.data);
    logger.info(`API Request: ${requestConfig.method?.toUpperCase()} ${requestConfig.url}`, {
      requestId,
      ...(sanitizedData && typeof sanitizedData === 'object' ? { data: sanitizedData } : {}),
    });
    return requestConfig;
  });

  client.interceptors.response.use(
    (response) => {
      const requestId = response.config.headers['x-request-id'] as string;
      logger.info(`API Response: ${response.status}`, {
        requestId,
        url: response.config.url,
        status: response.status,
      });
      return response;
    },
    (error) => {
      const requestId = error.config?.headers?.['x-request-id'] as string;
      throw ApiErrorHandler.handle(error, requestId);
    }
  );

  return client;
}
