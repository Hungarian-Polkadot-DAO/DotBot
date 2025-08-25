import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders DotBot title', () => {
  render(<App />);
  const titleElement = screen.getByText(/DotBot/i);
  expect(titleElement).toBeInTheDocument();
});

test('renders welcome message', () => {
  render(<App />);
  const welcomeElement = screen.getByText(/What's the dot you need help with?/i);
  expect(welcomeElement).toBeInTheDocument();
});

test('renders quick action buttons', () => {
  render(<App />);
  const checkBalanceButton = screen.getByText(/Check Balance/i);
  const transferButton = screen.getByText(/Transfer/i);
  const statusButton = screen.getByText(/Status/i);
  
  expect(checkBalanceButton).toBeInTheDocument();
  expect(transferButton).toBeInTheDocument();
  expect(statusButton).toBeInTheDocument();
});
