package com.pantrypal;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration(proxyBeanMethods = false)
public class NotificationDeliveryConfig {
    @Bean
    ThreadPoolTaskExecutor notificationDeliveryExecutor() {
        var executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setQueueCapacity(128);
        executor.setThreadNamePrefix("pantry-notifications-");
        executor.setDaemon(true);
        // The default abort policy rejects overflow; never run delivery on a transaction thread.
        return executor;
    }
}
