// Copyright (c) 2025 Ronan LE MEILLAT, SCTG Development
// This file is part of the doc-viewer project and is licensed under the
// SCTG Development Non-Commercial License v1.0 (see LICENSE.md for details).
//! Message level handling for command output.

/// Controls how much successful command output is printed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum MessageLevel {
    /// Print nothing for successful operations.
    Quiet,
    /// Print high-level progress and summaries.
    Info,
    /// Print per-file operations and useful diagnostics.
    Debug,
    /// Print every available detail.
    All,
}

impl MessageLevel {
    /// Builds a message level from repeated `-v` occurrences.
    ///
    /// # Examples
    ///
    /// ```
    /// assert_eq!(rencrypt::output::MessageLevel::from_count(0).as_str(), "QUIET");
    /// assert_eq!(rencrypt::output::MessageLevel::from_count(2).as_str(), "DEBUG");
    /// ```
    pub fn from_count(count: u8) -> Self {
        match count {
            0 => Self::Quiet,
            1 => Self::Info,
            2 => Self::Debug,
            _ => Self::All,
        }
    }

    /// Returns true when this level allows an informational message.
    pub fn allows_info(self) -> bool {
        self >= Self::Info
    }

    /// Returns true when this level allows a debug message.
    pub fn allows_debug(self) -> bool {
        self >= Self::Debug
    }

    /// Returns true when this level allows all available output.
    pub fn allows_all(self) -> bool {
        self >= Self::All
    }

    /// Returns the stable uppercase label for this level.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Quiet => "QUIET",
            Self::Info => "INFO",
            Self::Debug => "DEBUG",
            Self::All => "ALL",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::MessageLevel;

    #[test]
    fn maps_verbose_counts_to_levels() {
        assert_eq!(MessageLevel::from_count(0), MessageLevel::Quiet);
        assert_eq!(MessageLevel::from_count(1), MessageLevel::Info);
        assert_eq!(MessageLevel::from_count(2), MessageLevel::Debug);
        assert_eq!(MessageLevel::from_count(3), MessageLevel::All);
        assert_eq!(MessageLevel::from_count(9), MessageLevel::All);
    }
}
